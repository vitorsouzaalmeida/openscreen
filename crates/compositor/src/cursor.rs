//! Piste curseur depuis un `.cursor.json` openscreen. Fournit position interpolée
//! et facteur de « click bounce » — consommés par frame (temps fractionnaire), donc
//! le motion blur du curseur vient gratuitement du supersampling temporel.

use crate::scene::{SceneCursorInteraction, SceneCursorPatch, SceneCursorSample};
use anyhow::{Context, Result};

// Paramètres de suivi auto — parité stricte avec
// `src/lib/zoomMath/constants.ts` (AUTO_FOLLOW_PARAMS), partagés
// là-bas entre preview et export pour que la caméra suive le curseur à l'identique.
const AUTO_FOLLOW_MIN_FACTOR: f32 = 0.1;
const AUTO_FOLLOW_MAX_FACTOR: f32 = 0.25;
const AUTO_FOLLOW_RAMP_DISTANCE: f32 = 0.15;
const AUTO_FOLLOW_REFERENCE_MS: f32 = 1000.0 / 40.0;

/// Part de la vue zoomée, par axe, où le pointeur bouge sans que la vue le suive : sa moitié
/// centrale (`follow_in_view`). Au-delà, la vue le rattrape juste assez pour le ramener au bord de
/// cette zone. Sans elle, la vue suivait chaque petit geste et le cadrage paraissait nerveux.
const FOLLOW_DEAD_ZONE: f32 = 0.5;

// Convergence du curseur dessiné sur le point cliqué (`pinned_at`). L'approche accompagne la
// plongée du curseur modélisé, et la tenue couvre son appui (du clic à 80 ms après).
const PIN_APPROACH_S: f32 = 0.25;
const PIN_HOLD_S: f32 = 0.1;
const PIN_RELEASE_S: f32 = 0.25;

fn smoothstep01(x: f32) -> f32 {
    let u = x.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

#[derive(Clone)]
pub struct CursorTrack {
    /// (t_secondes, cx, cy) normalisés dans le cadre screen, triés.
    samples: Vec<(f32, f32, f32)>,
    /// Même piste après lissage exponentiel adaptatif — ce que le suivi auto du zoom doit
    /// consommer. `samples` reste la piste BRUTE : le rendu du curseur lui-même et le click
    /// bounce doivent coller à la position réelle, seule la caméra est amortie.
    follow_samples: Vec<(f32, f32, f32)>,
    /// instants de clic (secondes) dans la fenêtre.
    clicks: Vec<f32>,
    /// Position BRUTE de chaque clic (même ordre que `clicks`) : le pixel où l'utilisateur a
    /// réellement cliqué. `smoothed()` la garde telle quelle, alors que la piste lissée passe
    /// ailleurs à cet instant (cf. `pinned_at`).
    click_points: Vec<(f32, f32)>,
    /// CHANGEMENTS de visibilité : `(instant, visible)`, triés. Comme `types`, c'est une
    /// fonction en escalier. Une piste ancienne sans champ `visible` reste visible.
    visibility: Vec<(f32, bool)>,
    /// CHANGEMENTS d'état du curseur : (instant, `"arrow"` / `"text"` / `"pointer"` / …), triés.
    /// Une fonction en escalier, pas une valeur par échantillon : l'état tient sur des secondes
    /// entières alors que la position est échantillonnée toutes les 33 ms (~30 Hz, cf.
    /// `CURSOR_SAMPLE_INTERVAL_MS` côté Electron), donc n'enregistrer que les
    /// transitions garde cette liste minuscule et rend `type_at` trivial.
    types: Vec<(f32, String)>,
    /// Les vues du suivi à zone morte déjà rejouées, par `(t0, fin, échelle)` : une par région auto
    /// (`follow_in_view`). Partagé entre clones, qui ont les mêmes échantillons.
    view_cache:
        std::sync::Arc<std::sync::Mutex<Vec<(ViewKey, std::sync::Arc<Vec<(f32, f32, f32)>>)>>>,
}

type ViewKey = (u32, u32, u32, [u32; 4]);
/// L'image entière comme recadrage `[x0, y0, x1, y1]` : le repère de la piste elle-même.
pub const WHOLE_FRAME: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
/// Assez pour toutes les régions auto d'un clip ; au-delà, la plus ancienne est rejouée.
const VIEW_CACHE_LEN: usize = 32;

/// Interpolation linéaire dans une liste `(t, x, y)` triée ; saturation aux bornes.
fn sample_at(samples: &[(f32, f32, f32)], t: f32) -> Option<(f32, f32)> {
    if samples.is_empty() {
        return None;
    }
    if t <= samples[0].0 {
        let s = samples[0];
        return Some((s.1, s.2));
    }
    if t >= samples[samples.len() - 1].0 {
        let s = *samples.last().unwrap();
        return Some((s.1, s.2));
    }
    // recherche du segment encadrant
    let i = samples.partition_point(|s| s.0 <= t);
    let a = samples[i - 1];
    let b = samples[i];
    let f = if b.0 > a.0 {
        (t - a.0) / (b.0 - a.0)
    } else {
        0.0
    };
    Some((a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f))
}

/// Port de `advanceFollowFocus` (`cursorFollowUtils.ts`) : lissage exponentiel dont le facteur
/// croît avec la distance à la cible (loin = rattrape vite, près = décélère), corrigé en temps
/// pour être indépendant de la cadence.
///
/// La version TS est **séquentielle** : elle avance un `prev` d'une frame à l'autre. Rejouer ça
/// par frame ici ferait dépendre l'image du chemin parcouru pour l'atteindre — deux rendus du
/// même instant divergeraient selon qu'on y arrive en lecture ou par un seek, et la preview ne
/// correspondrait plus à l'export. On applique donc le même filtre UNE fois, sur les
/// échantillons de télémétrie eux-mêmes : le résultat est identique en lecture linéaire et reste
/// une pure fonction de `t`.
fn smooth_follow_samples(samples: &[(f32, f32, f32)]) -> Vec<(f32, f32, f32)> {
    let mut smoothed: Vec<(f32, f32, f32)> = Vec::with_capacity(samples.len());
    let mut prev: Option<(f32, f32, f32)> = None;
    for &(t, x, y) in samples {
        let Some((prev_t, px, py)) = prev else {
            smoothed.push((t, x, y));
            prev = Some((t, x, y));
            continue;
        };
        let dt_ms = (t - prev_t) * 1000.0;
        if !(dt_ms > 0.0) {
            // Horodatages dupliqués : on garde la valeur déjà lissée plutôt que de diviser par 0.
            smoothed.push((t, px, py));
            prev = Some((t, px, py));
            continue;
        }
        let (nx, ny) = follow_step((px, py), (x, y), dt_ms);
        smoothed.push((t, nx, ny));
        prev = Some((t, nx, ny));
    }
    smoothed
}

/// Un point de la piste dans le recadrage `[x0, y0, x1, y1]`, en 0..1 de celui-ci. Sans borne :
/// un pointeur hors du recadrage tire la vue vers ce bord, comme hors de l'écran. L'image
/// entière rend le point tel quel, au bit près.
fn in_crop(crop: [f32; 4], (x, y): (f32, f32)) -> (f32, f32) {
    let [x0, y0, x1, y1] = crop;
    ((x - x0) / (x1 - x0).max(1e-6), (y - y0) / (y1 - y0).max(1e-6))
}

/// Un pas du lissage de suivi : `from` avance vers `to` d'un facteur qui croît avec la distance
/// (loin = rattrape vite, près = décélère), corrigé en temps sur `dt_ms`.
fn follow_step(from: (f32, f32), to: (f32, f32), dt_ms: f32) -> (f32, f32) {
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let distance = (dx * dx + dy * dy).sqrt();
    let ramp = (distance / AUTO_FOLLOW_RAMP_DISTANCE).min(1.0);
    let base = AUTO_FOLLOW_MIN_FACTOR + (AUTO_FOLLOW_MAX_FACTOR - AUTO_FOLLOW_MIN_FACTOR) * ramp;
    let factor = 1.0 - (1.0 - base).powf(dt_ms / AUTO_FOLLOW_REFERENCE_MS);
    (from.0 + dx * factor, from.1 + dy * factor)
}

/// The window every production reader loads: the whole recording. A day is far longer than
/// any take, and `load_patched` only keeps the samples that exist.
const WHOLE_RECORDING_S: f64 = 24.0 * 3600.0;

/// Where a take's recorded pointer track lives: beside its screen video.
pub fn cursor_sidecar_path(screen_path: &str) -> String {
    format!("{screen_path}.cursor.json")
}

/// One entry of the raw list `load_patched` builds a track from, whether it was recorded or
/// comes from a patch. Both are reduced to this before anything is derived from them, so the
/// loop that builds positions, clicks, cursor types and visibility cannot tell them apart.
struct RawSample<'a> {
    /// Milliseconds from the start of the recording; `-1` when the entry has no time, which no
    /// window keeps.
    time_ms: f64,
    cx: f32,
    cy: f32,
    visible: bool,
    /// A press. Whether it counts as a click also depends on `visible` (see `load_patched`).
    click: bool,
    cursor_type: &'a str,
}

impl<'a> RawSample<'a> {
    fn recorded(s: &'a serde_json::Value) -> RawSample<'a> {
        RawSample {
            time_ms: s["timeMs"].as_f64().unwrap_or(-1.0),
            cx: s["cx"].as_f64().unwrap_or(0.0) as f32,
            cy: s["cy"].as_f64().unwrap_or(0.0) as f32,
            visible: s
                .get("visible")
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
            click: s["interactionType"].as_str() == Some("click"),
            // Le helper macOS rend nil hors texte/pointeur pour que le rendu retombe sur
            // la flèche. Le sidecar stocke ça en JSON null ou omet la clé.
            // Ignorer ces échantillons gardait le dernier type sémantique
            // (`pointer`/`text`) : un thème restait collé après le retour à la
            // flèche. Null / absence = reset vers `arrow`.
            cursor_type: match s.get("cursorType") {
                Some(v) => v
                    .as_str()
                    .filter(|label| !label.is_empty())
                    .unwrap_or("arrow"),
                None => "arrow",
            },
        }
    }

    /// A patch sample names no cursor type, which reads as the arrow exactly as a recorded
    /// sample without the key does: a `pointer` recorded before the span does not stick to it.
    fn patched(s: &SceneCursorSample) -> RawSample<'a> {
        RawSample {
            time_ms: s.time_ms,
            cx: s.cx,
            cy: s.cy,
            visible: s.visible,
            click: s.interaction_type == SceneCursorInteraction::Click,
            cursor_type: "arrow",
        }
    }
}

/// The `samples` array of a `.cursor.json` sidecar, as written.
fn read_sidecar_samples(path: &str) -> Result<Vec<serde_json::Value>> {
    let txt = std::fs::read_to_string(path).with_context(|| format!("lecture {path}"))?;
    let mut v: serde_json::Value = serde_json::from_str(&txt)?;
    match v.get_mut("samples").map(serde_json::Value::take) {
        Some(serde_json::Value::Array(samples)) => Ok(samples),
        _ => anyhow::bail!("samples[]"),
    }
}

impl CursorTrack {
    /// Seul point de construction : garantit que `follow_samples` est toujours dérivé des
    /// échantillons courants. Une piste re-lissée (`smoothed`) recalcule donc aussi son suivi,
    /// pour que la caméra suive la trajectoire que l'utilisateur voit réellement.
    pub(crate) fn new(
        samples: Vec<(f32, f32, f32)>,
        clicks: Vec<f32>,
        types: Vec<(f32, String)>,
    ) -> CursorTrack {
        CursorTrack::new_with_visibility(samples, clicks, types, Vec::new())
    }

    pub(crate) fn new_with_visibility(
        samples: Vec<(f32, f32, f32)>,
        clicks: Vec<f32>,
        types: Vec<(f32, String)>,
        visibility: Vec<(f32, bool)>,
    ) -> CursorTrack {
        let follow_samples = smooth_follow_samples(&samples);
        let click_points = clicks
            .iter()
            .map(|&tc| sample_at(&samples, tc).unwrap_or((0.0, 0.0)))
            .collect();
        CursorTrack {
            samples,
            follow_samples,
            clicks,
            click_points,
            visibility,
            types,
            view_cache: Default::default(),
        }
    }

    /// The same track seen on a picture turned by 180°: every position mirrored, times,
    /// clicks, visibility and cursor types unchanged. A turned clip is planned entirely in
    /// what the viewer sees, so its telemetry is turned once here rather than at every reader.
    pub fn turned(&self) -> CursorTrack {
        let flip =
            |v: &[(f32, f32, f32)]| v.iter().map(|&(t, x, y)| (t, 1.0 - x, 1.0 - y)).collect();
        CursorTrack {
            samples: flip(&self.samples),
            follow_samples: flip(&self.follow_samples),
            clicks: self.clicks.clone(),
            click_points: self.click_points.iter().map(|&(x, y)| (1.0 - x, 1.0 - y)).collect(),
            visibility: self.visibility.clone(),
            types: self.types.clone(),
            view_cache: Default::default(),
        }
    }

    /// Visibilité enregistrée au temps `t`. Les anciens sidecars qui n'ont pas ce champ sont
    /// visibles par défaut, comme les lecteurs TypeScript.
    pub fn visible_at(&self, t: f32) -> bool {
        let i = self.visibility.partition_point(|(tc, _)| *tc <= t);
        if i == 0 {
            true
        } else {
            self.visibility[i - 1].1
        }
    }

    /// État du curseur au temps `t` : la dernière transition à `t` ou avant. `None` avant la
    /// première (enregistrement sans état tagué → l'appelant retombe sur la flèche).
    pub fn type_at(&self, t: f32) -> Option<&str> {
        let i = self.types.partition_point(|(tc, _)| *tc <= t);
        (i > 0).then(|| self.types[i - 1].1.as_str())
    }

    /// Nombre d'échantillons de la piste (utile au diag de chargement).
    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }

    /// Charge la fenêtre [offset_ms, offset_ms + dur_s*1000] et la ramène à t=0.
    pub fn load(path: &str, offset_ms: f64, dur_s: f64) -> Result<CursorTrack> {
        Self::load_patched(path, &[], offset_ms, dur_s)
    }

    /// A take's whole pointer track as it is drawn: the recording beside `screen_path`, with
    /// the scene's cursor patches for that take (`Scene::cursor_patches_for`) swapped in. The
    /// one way the preview, its prefetch and the export load a clip's track, so that none of
    /// them can show a pointer the others do not.
    pub fn load_take(screen_path: &str, patches: &[&SceneCursorPatch]) -> Result<CursorTrack> {
        Self::load_patched(&cursor_sidecar_path(screen_path), patches, 0.0, WHOLE_RECORDING_S)
    }

    /// `load`, with cursor patches applied to the recording first. The sidecar is read-only: an
    /// edit of the pointer lives in the project, and the app sends it as ready-made samples.
    ///
    /// Each patch cuts the RECORDED samples of `[start_ms, end_ms]` out, ends included and
    /// whatever they carried (position, click, visibility, cursor type), and adds its own. This
    /// happens on the raw sample list, before anything is derived from it, which is what makes
    /// the recording resume by itself after the span: the next recorded sample still carries
    /// its own `visible` and `cursorType`, and the loop below turns that into a transition as
    /// it does for any other sample. Patching the built step functions instead would have to
    /// reconstruct the state the recording was in at the end of every span.
    ///
    /// Same result as `applyCursorOverrides` (`cursor-overrides.ts`), which the TypeScript
    /// readers of the track go through: recorded samples outside every span, then the patches'
    /// samples in the order given, sorted by time with ties left in that order. A patch never
    /// removes another patch's samples, so two that overlap (the app sends none) both show.
    /// Nothing is generated or interpolated here; a patch without samples leaves a gap that
    /// `at` crosses in a straight line, like any other gap between two samples.
    ///
    /// A sidecar that is missing or unreadable is an error only when there is no patch: with
    /// one, the track is the patches alone, which is how a take recorded without a pointer
    /// gets one. Patch times are whole-recording milliseconds like the sidecar's, so the
    /// `offset_ms` window applies to the patched list as it does to a recorded one.
    pub fn load_patched(
        path: &str,
        patches: &[&SceneCursorPatch],
        offset_ms: f64,
        dur_s: f64,
    ) -> Result<CursorTrack> {
        let recorded = match read_sidecar_samples(path) {
            Ok(samples) => samples,
            Err(error) if patches.is_empty() => return Err(error),
            Err(_) => Vec::new(),
        };
        let mut raw: Vec<RawSample> = recorded.iter().map(RawSample::recorded).collect();
        // Without a patch the list stays exactly as the file has it, order included.
        if !patches.is_empty() {
            raw.retain(|s| !patches.iter().any(|patch| patch.covers(s.time_ms)));
            raw.extend(patches.iter().flat_map(|patch| patch.samples.iter().map(RawSample::patched)));
            // Stable: two samples of one instant keep the order they were added in.
            raw.sort_by(|a, b| a.time_ms.total_cmp(&b.time_ms));
        }
        let mut samples = Vec::new();
        let mut clicks = Vec::new();
        let mut types: Vec<(f32, String)> = Vec::new();
        let mut visibility_at_offset = true;
        let mut visibility_sample_time = f64::NEG_INFINITY;
        // A clipped track inherits the last recorded state at its source offset. Using the first
        // later sample would reveal a cursor early when that sample is the transition to visible.
        // Read from the patched list: a window that starts inside a patch starts in its state.
        for s in &raw {
            let tm = s.time_ms;
            if tm >= 0.0 && tm <= offset_ms && tm >= visibility_sample_time {
                visibility_sample_time = tm;
                visibility_at_offset = s.visible;
            }
        }
        let mut visibility = vec![(0.0, visibility_at_offset)];
        let end = offset_ms + dur_s * 1000.0;
        for s in &raw {
            let tm = s.time_ms;
            if tm < offset_ms || tm > end {
                continue;
            }
            let t = ((tm - offset_ms) / 1000.0) as f32;
            samples.push((t, s.cx, s.cy));
            if visibility.last().map(|(_, previous)| *previous) != Some(s.visible) {
                visibility.push((t, s.visible));
            }
            if s.visible && s.click {
                clicks.push(t);
            }
            // Seules les TRANSITIONS sont retenues — voir `types`.
            if types.last().map(|(_, prev)| prev.as_str()) != Some(s.cursor_type) {
                types.push((t, s.cursor_type.to_string()));
            }
        }
        samples.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        clicks.sort_by(|a, b| a.partial_cmp(b).unwrap());
        types.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        visibility.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        Ok(CursorTrack::new_with_visibility(
            samples, clicks, types, visibility,
        ))
    }

    /// Position lissée au temps `t`, pour le suivi auto du zoom. La télémétrie brute est
    /// échantillonnée trop finement pour piloter une caméra directement : la suivre au sample
    /// près donne un pan nerveux. Voir `smooth_follow_samples`.
    pub fn follow_at(&self, t: f32) -> Option<(f32, f32)> {
        sample_at(&self.follow_samples, t)
    }

    /// Le centre de la vue d'un zoom auto d'échelle `scale` à `t`, parti de `follow_at(t0)` en
    /// `t0` : `follow_at` avec une zone morte. La vue ne bouge pas tant que le pointeur reste dans
    /// la part `FOLLOW_DEAD_ZONE` de sa largeur autour de son centre ; il en sort, elle le
    /// rattrape avec le même lissage, juste assez pour le ramener au bord de la zone. Bornée à ce
    /// qu'une vue de `1/scale` peut atteindre, pour que la zone se mesure contre la vue affichée.
    ///
    /// Tout se joue dans le recadrage `crop` du clip (`[x0, y0, x1, y1]` dans le repère de la
    /// piste) : la vue zoomée en est une part, et le focus rendu s'y exprime en 0..1, comme le
    /// focus manuel. Lu dans l'image entière, le pointeur sortait de la vue dès qu'un recadrage
    /// la décentrait.
    ///
    /// Rejouée depuis `t0` sur les échantillons BRUTS, puis mise en cache jusqu'à `t_end` : une
    /// fonction pure de `(t0, t, t_end)`, donc la même en preview et à l'export, après un seek
    /// comme en lecture. Le cache ne garde rien après la fenêtre de la région.
    pub fn follow_in_view(
        &self,
        t0: f32,
        t: f32,
        t_end: f32,
        scale: f32,
        crop: [f32; 4],
    ) -> Option<(f32, f32)> {
        let t_end = t_end.max(t0);
        let t = t.clamp(t0, t_end);
        let states = self.view_states(t0, t_end, scale, crop)?;
        let half = 0.5 / scale.max(1.0);
        let reach = |v: f32| v.clamp(half, 1.0 - half);
        // Après le dernier échantillon, la vue continue de rattraper le pointeur resté immobile
        // jusqu'au bord de la zone, au lieu de se figer à mi-course.
        let &(at, vx, vy) = states.last()?;
        if t > at {
            let (_, x, y) = *self.samples.last()?;
            let (x, y) = in_crop(crop, (x, y));
            let dead = half * FOLLOW_DEAD_ZONE;
            let pull = |cursor: f32, view: f32| cursor - (cursor - view).clamp(-dead, dead);
            let (nx, ny) = follow_step((vx, vy), (pull(x, vx), pull(y, vy)), (t - at) * 1000.0);
            return Some((reach(nx), reach(ny)));
        }
        if states.len() == 1 {
            return Some((vx, vy));
        }
        // Entre deux états, linéaire, comme `follow_at`.
        let i = states.partition_point(|s| s.0 < t).max(1);
        let (a, b) = (states[i - 1], states[i]);
        let f = if b.0 > a.0 {
            ((t - a.0) / (b.0 - a.0)).clamp(0.0, 1.0)
        } else {
            1.0
        };
        Some((a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f))
    }

    /// Les états `(t, x, y)` de `t0` à la fin de la fenêtre d'une région. Le dernier point est
    /// interpolé à `t_end` si le curseur a encore des échantillons après cette fenêtre.
    fn view_states(
        &self,
        t0: f32,
        t_end: f32,
        scale: f32,
        crop: [f32; 4],
    ) -> Option<std::sync::Arc<Vec<(f32, f32, f32)>>> {
        let t_end = t_end.max(t0);
        let key = (t0.to_bits(), t_end.to_bits(), scale.to_bits(), crop.map(f32::to_bits));
        if let Some((_, v)) = self.view_cache.lock().ok()?.iter().find(|(k, _)| *k == key) {
            return Some(v.clone());
        }
        let half = 0.5 / scale.max(1.0);
        let dead = half * FOLLOW_DEAD_ZONE;
        let reach = |v: f32| v.clamp(half, 1.0 - half);
        // La cible : le point qui ramène le pointeur au bord de la zone, la vue elle-même dedans.
        let pull = |cursor: f32, view: f32| cursor - (cursor - view).clamp(-dead, dead);
        let (x0, y0) = in_crop(crop, self.follow_at(t0)?);
        let mut view = (reach(x0), reach(y0));
        let mut states = vec![(t0, view.0, view.1)];
        let first = self.samples.partition_point(|s| s.0 <= t0);
        let end = self.samples.partition_point(|s| s.0 <= t_end);
        for &(ts, x, y) in &self.samples[first..end] {
            let (x, y) = in_crop(crop, (x, y));
            let at = states.last().map_or(t0, |s| s.0);
            let (nx, ny) =
                follow_step(view, (pull(x, view.0), pull(y, view.1)), (ts - at) * 1000.0);
            view = (reach(nx), reach(ny));
            states.push((ts, view.0, view.1));
        }
        let at = states.last().map_or(t0, |s| s.0);
        if at < t_end {
            if let Some(&(ts, x, y)) = self.samples.get(end) {
                let (x, y) = in_crop(crop, (x, y));
                let (nx, ny) =
                    follow_step(view, (pull(x, view.0), pull(y, view.1)), (ts - at) * 1000.0);
                let f = ((t_end - at) / (ts - at)).clamp(0.0, 1.0);
                states.push((
                    t_end,
                    view.0 + (nx - view.0) * f,
                    view.1 + (ny - view.1) * f,
                ));
            }
        }
        let states = std::sync::Arc::new(states);
        let mut cache = self.view_cache.lock().ok()?;
        if cache.len() >= VIEW_CACHE_LEN {
            cache.remove(0);
        }
        cache.push((key, states.clone()));
        Some(states)
    }

    /// Position (cx, cy) au temps `t` (interpolation linéaire), ou None si hors piste. Brute, sauf
    /// sur une piste `smoothed()`.
    pub fn at(&self, t: f32) -> Option<(f32, f32)> {
        sample_at(&self.samples, t)
    }

    /// `at(t)`, ramenée sur la position brute de chaque clic autour de lui : la pointe du curseur
    /// modélisé doit toucher le pixel cliqué. Sur une piste lissée, le ressort traîne derrière la
    /// souris et le contact tombait à côté de la cible ; sans lissage, la piste brute dérive pendant
    /// le contact dès que la souris repart.
    ///
    /// Pour chaque clic `tc`, un poids vers son point : il monte en smoothstep sur
    /// `PIN_APPROACH_S`, vaut 1 sur `[tc, tc + PIN_HOLD_S]` (le contact), puis retombe en
    /// smoothstep sur `PIN_RELEASE_S`. Les clics s'appliquent dans l'ordre, le plus récent
    /// l'emporte. L'approche d'un clic ne commence qu'à la fin de la tenue du précédent : deux clics
    /// rapprochés posent chacun la pointe sur leur point. Sous `2 * PIN_HOLD_S` d'écart, la tenue et
    /// l'approche suivante se partagent l'écart à parts égales. Continue en `t` ; hors de ces
    /// fenêtres, `at(t)` à l'identique.
    pub fn pinned_at(&self, t: f32) -> Option<(f32, f32)> {
        let (mut x, mut y) = self.at(t)?;
        let lo = self
            .clicks
            .partition_point(|&tc| tc <= t - PIN_HOLD_S - PIN_RELEASE_S);
        let hi = self.clicks.partition_point(|&tc| tc < t + PIN_APPROACH_S);
        let hold = |i: usize| match self.clicks.get(i + 1) {
            Some(&next) => ((next - self.clicks[i]) * 0.5).min(PIN_HOLD_S),
            None => PIN_HOLD_S,
        };
        for i in lo..hi.max(lo) {
            let d = t - self.clicks[i];
            let w = if d < 0.0 {
                let approach = match i.checked_sub(1) {
                    Some(p) => (self.clicks[i] - self.clicks[p] - hold(p)).clamp(1e-3, PIN_APPROACH_S),
                    None => PIN_APPROACH_S,
                };
                smoothstep01(1.0 + d / approach)
            } else {
                1.0 - smoothstep01((d - hold(i)) / PIN_RELEASE_S)
            };
            let (cx, cy) = self.click_points[i];
            (x, y) = if w >= 1.0 {
                (cx, cy)
            } else {
                (x + (cx - x) * w, y + (cy - y) * w)
            };
        }
        Some((x, y))
    }

    /// Les clics de `(lo, hi]` avec leur position brute, triés.
    pub fn clicks_with_points(
        &self,
        lo: f32,
        hi: f32,
    ) -> impl Iterator<Item = (f32, (f32, f32))> + '_ {
        let a = self.clicks.partition_point(|&tc| tc <= lo);
        let b = self.clicks.partition_point(|&tc| tc <= hi).max(a);
        self.clicks[a..b]
            .iter()
            .copied()
            .zip(self.click_points[a..b].iter().copied())
    }

    /// Facteur d'échelle « click bounce ». Cette fonction est la SEULE référence de la courbe :
    /// son ancien jumeau TS (`nativeCursor.ts`) a été supprimé avec pixi.js, et
    /// `scripts/inspect-native-cursor-click-bounce.mjs` ne fait que la recopier. Le curseur
    /// PRESSE (rétrécit jusqu'à 0.76, 0..38% de la fenêtre d'animation) PUIS REBONDIT (grossit
    /// jusqu'à 1.16, 38..100%), pas un simple pop qui ne fait que grossir puis redécroître. Seul le clic le
    /// plus récent précédant `t` compte (au-delà de la fenêtre, un clic antérieur n'a plus
    /// aucun effet — contrairement à l'ancienne décroissance exponentielle à queue infinie qui
    /// masquait ce bug). L'amplitude utilisateur (clickBounce) s'applique dans `plan_cursor`.
    pub fn bounce(&self, t: f32) -> f32 {
        const ANIM_S: f32 = 0.26; // 260 ms
        const PRESS_FRAC: f32 = 0.38;
        let Some(tc) = self.last_click_at(t) else {
            return 1.0;
        };
        let elapsed = (t - tc) / ANIM_S;
        if elapsed >= 1.0 {
            return 1.0;
        }
        if elapsed < PRESS_FRAC {
            let press = (elapsed / PRESS_FRAC * std::f32::consts::PI).sin();
            1.0 - press * 0.24
        } else {
            let rebound =
                ((elapsed - PRESS_FRAC) / (1.0 - PRESS_FRAC) * std::f32::consts::PI).sin();
            1.0 + rebound * 0.16
        }
    }

    /// L'instant du dernier clic à `t` ou avant, `None` s'il n'y en a pas. C'est le point de
    /// départ commun du rebond d'échelle (`bounce`) et de l'abaissement de la hauteur du curseur
    /// modélisé — les deux doivent lire le MÊME contact, sinon le sprite s'écrase et se pose à
    /// deux instants différents. Les clics sont triés croissant (voir `CursorTrack::new`).
    pub(crate) fn last_click_at(&self, t: f32) -> Option<f32> {
        let i = self.clicks.partition_point(|&tc| tc <= t);
        if i == 0 {
            return None;
        }
        Some(self.clicks[i - 1])
    }

    /// Les instants de clic dans `(lo, hi]`, triés. L'impact du clic sur le plan
    /// (`regions::click_impact`) les somme tous, là où `bounce` ne garde que le dernier.
    pub fn clicks_between(&self, lo: f32, hi: f32) -> &[f32] {
        let a = self.clicks.partition_point(|&tc| tc <= lo);
        let b = self.clicks.partition_point(|&tc| tc <= hi);
        &self.clicks[a..b.max(a)]
    }

    /// Piste repositionnée par un ressort-amortisseur (parité `cursorPathSmoothing.ts` :
    /// resample à 240 Hz + intégration semi-implicite d'Euler). `factor` 0..1 = valeur brute
    /// du slider (0 = passthrough, retourne un clone). Les clics restent sur leurs instants
    /// bruts (le bounce est temporel, pas positionnel — ne doit pas suivre le lissage).
    pub fn smoothed(&self, factor: f32) -> CursorTrack {
        if self.samples.len() < 2 || factor <= 0.0 {
            return CursorTrack::new_with_visibility(
                self.samples.clone(),
                self.clicks.clone(),
                self.types.clone(),
                self.visibility.clone(),
            );
        }
        const STEP_S: f32 = 1.0 / 240.0;
        let start = self.samples[0].0;
        let end = self.samples[self.samples.len() - 1].0;
        let step_count = (((end - start) / STEP_S).round() as usize).max(1);
        let n = step_count + 1;
        let mut times = Vec::with_capacity(n);
        let mut raw_x = Vec::with_capacity(n);
        let mut raw_y = Vec::with_capacity(n);
        for i in 0..n {
            let t = if i == n - 1 {
                end
            } else {
                start + i as f32 * STEP_S
            };
            let (cx, cy) = self.at(t).unwrap_or((0.0, 0.0));
            times.push(t);
            raw_x.push(cx);
            raw_y.push(cy);
        }
        let (stiffness, damping, mass) = cursor_spring_config(factor);
        // Une phase masquée coupe le ressort. Au retour, le curseur repart du premier point
        // réellement visible au lieu de traverser la trajectoire cachée avec du retard.
        let mut xs = Vec::with_capacity(n);
        let mut ys = Vec::with_capacity(n);
        let mut run_start = 0;
        while run_start < n {
            let visible = self.visible_at(times[run_start]);
            let mut run_end = run_start + 1;
            while run_end < n && self.visible_at(times[run_end]) == visible {
                run_end += 1;
            }
            xs.extend(spring_smooth(
                &raw_x[run_start..run_end],
                stiffness,
                damping,
                mass,
                STEP_S,
            ));
            ys.extend(spring_smooth(
                &raw_y[run_start..run_end],
                stiffness,
                damping,
                mass,
                STEP_S,
            ));
            run_start = run_end;
        }
        let samples = times
            .into_iter()
            .zip(xs)
            .zip(ys)
            .map(|((t, x), y)| (t, x, y))
            .collect();
        // Comme les clics, les changements d'état gardent leurs instants bruts : le lissage
        // déplace la trajectoire, pas la chronologie de ce que faisait l'utilisateur. Les points
        // cliqués restent ceux de la piste brute.
        CursorTrack {
            click_points: self.click_points.clone(),
            ..CursorTrack::new_with_visibility(
                samples,
                self.clicks.clone(),
                self.types.clone(),
                self.visibility.clone(),
            )
        }
    }

    /// Opacité du curseur (0.0..1.0) selon l'inactivité (auto-hide).
    /// Si `auto_hide` est faux, retourne toujours 1.0.
    /// Si `auto_hide` est vrai :
    /// - Le curseur reste à 1.0 tant qu'il bouge ou clique, et pendant 1.5s après le dernier mouvement/clic.
    /// - Entre 1.5s et 1.8s d'inactivité, il s'estompe linéairement de 1.0 à 0.0 (fade-out 300ms).
    /// - Au-delà de 1.8s, opacité 0.0.
    pub fn opacity_at(&self, t: f32, auto_hide: bool) -> f32 {
        if !auto_hide || self.samples.is_empty() {
            return 1.0;
        }

        const IDLE_TIMEOUT_S: f32 = 1.5;
        const FADE_DURATION_S: f32 = 0.3;
        const MOVE_THRESH_SQ: f32 = 0.015 * 0.015;

        let last_click = match self.clicks.partition_point(|&tc| tc <= t) {
            0 => None,
            i => Some(self.clicks[i - 1]),
        };

        let (cx, cy) = match self.at(t) {
            Some(p) => p,
            None => return 1.0,
        };

        let idx = self.samples.partition_point(|s| s.0 <= t);
        let start_t = self.samples[0].0;

        let mut arrival_t = if idx > 0 {
            self.samples[idx - 1].0
        } else {
            start_t
        };

        if idx > 0 {
            let mut i = idx - 1;
            while i > 0 {
                let prev = self.samples[i - 1];
                let dx = cx - prev.1;
                let dy = cy - prev.2;
                if dx * dx + dy * dy > MOVE_THRESH_SQ {
                    arrival_t = self.samples[i].0;
                    break;
                }
                if t - prev.0 > IDLE_TIMEOUT_S + FADE_DURATION_S {
                    arrival_t = prev.0;
                    break;
                }
                i -= 1;
                if i == 0 {
                    arrival_t = start_t;
                }
            }
        }

        if idx > 1 {
            let s1 = self.samples[idx - 1];
            let s0 = self.samples[idx - 2];
            let d_step = (s1.1 - s0.1) * (s1.1 - s0.1) + (s1.2 - s0.2) * (s1.2 - s0.2);
            if d_step > 0.005 * 0.005 && (t - s1.0).abs() < 0.1 {
                arrival_t = t;
            }
        }

        let mut last_activity = arrival_t;
        if let Some(tc) = last_click {
            if tc > last_activity {
                last_activity = tc;
            }
        }

        let idle_time = (t - last_activity).max(0.0);
        if idle_time <= IDLE_TIMEOUT_S {
            1.0
        } else if idle_time >= IDLE_TIMEOUT_S + FADE_DURATION_S {
            0.0
        } else {
            1.0 - (idle_time - IDLE_TIMEOUT_S) / FADE_DURATION_S
        }
    }
}

/// Ressort-amortisseur, intégration semi-implicite (symplectique) d'Euler — stable pour ces
/// raideurs à la grille 240 Hz (port direct de `springSmooth` en TS).
fn spring_smooth(
    targets: &[f32],
    stiffness: f32,
    damping: f32,
    mass: f32,
    step_s: f32,
) -> Vec<f32> {
    let mut out = vec![0.0f32; targets.len()];
    if targets.is_empty() {
        return out;
    }
    let mut x = targets[0];
    let mut v = 0.0f32;
    out[0] = x;
    for i in 1..targets.len() {
        let accel = (-stiffness * (x - targets[i]) - damping * v) / mass;
        v += accel * step_s;
        x += v * step_s;
        out[i] = x;
    }
    out
}

/// Port direct de `getCursorSpringConfig` (TS) → (stiffness, damping, mass). N'accepte que
/// 0..1 (plage réelle du slider, cf. `RightPanes.tsx` : `smoothing * 100` sur un slider 0..100).
fn cursor_spring_config(smoothing_factor: f32) -> (f32, f32, f32) {
    let clamped = smoothing_factor.clamp(0.0, 2.0);
    if clamped <= 0.0 {
        return (1000.0, 100.0, 1.0);
    }
    const LEGACY_MAX: f32 = 0.5;
    if clamped <= LEGACY_MAX {
        let n = (clamped / LEGACY_MAX).clamp(0.0, 1.0);
        return (760.0 - n * 420.0, 34.0 + n * 24.0, 0.55 + n * 0.45);
    }
    let n = ((clamped - LEGACY_MAX) / (2.0 - LEGACY_MAX)).clamp(0.0, 1.0);
    (340.0 - n * 180.0, 58.0 + n * 22.0, 1.0 + n * 0.35)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turned_track_mirrors_positions_and_keeps_times() {
        let t = CursorTrack::new(
            vec![(0.0, 0.2, 0.3), (1.0, 0.6, 0.9)],
            vec![0.5],
            vec![(0.0, "arrow".to_string())],
        );
        let r = t.turned();
        let (x, y) = r.at(0.0).unwrap();
        assert!((x - 0.8).abs() < 1e-6 && (y - 0.7).abs() < 1e-6, "({x}, {y})");
        assert_eq!(r.clicks_between(0.0, 1.0), t.clicks_between(0.0, 1.0));
        assert_eq!(r.type_at(0.0), t.type_at(0.0));
        let (fx, fy) = r.follow_at(1.0).unwrap();
        let (gx, gy) = t.follow_at(1.0).unwrap();
        assert!((fx - (1.0 - gx)).abs() < 1e-5 && (fy - (1.0 - gy)).abs() < 1e-5);
        // The click point turns with the picture: the click at 0.5 s was at (0.4, 0.6).
        let (px, py) = r.click_points[0];
        assert!((px - 0.6).abs() < 1e-6 && (py - 0.4).abs() < 1e-6, "({px}, {py})");
    }

    /// Zone morte du suivi auto : un pointeur qui tremble au centre de la vue ne la bouge pas ;
    /// un pointeur qui part loin est rattrapé, jusqu'au bord de la zone et pas au-delà.
    /// Les vues d'une région sont rejouées une fois puis relues : même réponse dans n'importe quel
    /// ordre, et la même qu'une piste neuve qui les rejoue.
    #[test]
    fn the_cached_follow_view_answers_like_a_fresh_replay() {
        let make = || {
            CursorTrack::new(
                (0..=150)
                    .map(|i| {
                        let t = i as f32 / 30.0;
                        (t, 0.5 + 0.3 * (t * 1.3).sin(), 0.5 + 0.2 * (t * 0.7).cos())
                    })
                    .collect(),
                vec![],
                vec![],
            )
        };
        let (cached, times) = (make(), [4.9f32, 0.2, 3.3, 0.0, 2.71, 4.0]);
        for t in times {
            let _ = cached.follow_in_view(0.4, t, 5.0, 2.0, WHOLE_FRAME);
        }
        for t in times {
            assert_eq!(
                cached.follow_in_view(0.4, t, 5.0, 2.0, WHOLE_FRAME),
                make().follow_in_view(0.4, t, 5.0, 2.0, WHOLE_FRAME),
                "t {t}"
            );
        }
        // Une autre région (autre départ, autre échelle) a ses propres vues.
        assert_ne!(
            cached.follow_in_view(1.0, 3.0, 5.0, 3.0, WHOLE_FRAME),
            cached.follow_in_view(0.4, 3.0, 5.0, 2.0, WHOLE_FRAME)
        );
    }

    #[test]
    fn the_follow_view_cache_stops_at_its_region_end() {
        let track = CursorTrack::new(
            (0..=300)
                .map(|i| {
                    let t = i as f32 / 30.0;
                    (t, 0.5 + 0.2 * (t * 0.7).sin(), 0.5)
                })
                .collect(),
            vec![],
            vec![],
        );

        let at_end = track.follow_in_view(0.0, 2.0, 2.0, 2.0, WHOLE_FRAME).unwrap();
        assert_eq!(track.follow_in_view(0.0, 8.0, 2.0, 2.0, WHOLE_FRAME), Some(at_end));

        let cache = track.view_cache.lock().unwrap();
        let states = &cache[0].1;
        assert!(states.iter().all(|(t, _, _)| *t <= 2.0));
        assert_eq!(states.last().unwrap().0, 2.0);
    }

    /// Après le dernier échantillon, la vue continue de rattraper un pointeur immobile hors de la
    /// zone morte, jusqu'à son bord, au lieu de se figer.
    #[test]
    fn the_follow_view_keeps_settling_after_the_last_sample() {
        // Le pointeur saute à 0,8 au dernier échantillon (2 s) ; bord de la zone à ×2 : 0,675.
        let track = CursorTrack::new(
            (0..=60)
                .map(|i| (i as f32 / 30.0, if i == 60 { 0.8 } else { 0.5 }, 0.5))
                .collect(),
            vec![],
            vec![],
        );
        let at = |t: f32| track.follow_in_view(0.0, t, 9.0, 2.0, WHOLE_FRAME).unwrap().0;
        assert!(
            at(2.0) < at(2.5) && at(2.5) < at(4.0),
            "{} {} {}",
            at(2.0),
            at(2.5),
            at(4.0)
        );
        assert!((at(8.0) - 0.675).abs() < 1e-3, "{}", at(8.0));
    }

    #[test]
    fn the_auto_follow_holds_still_inside_its_dead_zone() {
        // ×2 : vue de 0,5, zone morte de ±0,125 autour de son centre.
        let track = |f: fn(f32) -> f32| {
            CursorTrack::new(
                (0..=300)
                    .map(|i| {
                        let t = i as f32 / 30.0;
                        (t, f(t), 0.5)
                    })
                    .collect(),
                vec![],
                vec![],
            )
        };
        let jitter = track(|t| 0.5 + 0.08 * (t * 7.0).sin());
        for i in 0..=90 {
            let (x, y) = jitter
                .follow_in_view(0.0, i as f32 / 10.0, 9.0, 2.0, WHOLE_FRAME)
                .unwrap();
            assert!(
                (x - 0.5).abs() < 1e-6 && (y - 0.5).abs() < 1e-6,
                "t {} : {x}",
                i as f32 / 10.0
            );
        }
        // Sans zone morte, le suivi lissé, lui, tremble.
        let swing = (0..=90)
            .map(|i| jitter.follow_at(i as f32 / 10.0).unwrap().0)
            .fold(0.0f32, |m, x| m.max((x - 0.5).abs()));
        assert!(swing > 0.02, "{swing}");

        // Un saut à 0,8 à 2 s : la vue rattrape jusqu'à laisser le pointeur au bord de la zone.
        let jump = track(|t| if t < 2.0 { 0.5 } else { 0.8 });
        let settled = jump.follow_in_view(0.0, 9.0, 9.0, 2.0, WHOLE_FRAME).unwrap().0;
        assert!((settled - (0.8 - 0.125)).abs() < 1e-3, "{settled}");
        let early = jump.follow_in_view(0.0, 2.1, 9.0, 2.0, WHOLE_FRAME).unwrap().0;
        assert!(
            early > 0.5 && early < settled,
            "rattrapage progressif : {early}"
        );
        // Une pure fonction de (t0, t, t_end) : l'ordre des appels ne change rien.
        assert_eq!(jump.follow_in_view(0.0, 2.1, 9.0, 2.0, WHOLE_FRAME).unwrap().0, early);
    }

    /// L'état du curseur est une fonction en escalier : il tient jusqu'à la transition
    /// suivante, il n'est pas interpolé, et avant la première il n'y en a pas.
    #[test]
    fn cursor_type_holds_until_the_next_transition() {
        let track = CursorTrack::new(
            vec![(0.0, 0.0, 0.0), (2.0, 1.0, 1.0)],
            vec![],
            vec![
                (0.5, "arrow".into()),
                (1.0, "text".into()),
                (1.5, "pointer".into()),
            ],
        );

        assert_eq!(track.type_at(0.0), None, "avant la première transition");
        assert_eq!(
            track.type_at(0.5),
            Some("arrow"),
            "à l'instant même de la transition"
        );
        assert_eq!(
            track.type_at(0.9),
            Some("arrow"),
            "tient jusqu'à la suivante"
        );
        assert_eq!(track.type_at(1.2), Some("text"));
        assert_eq!(
            track.type_at(99.0),
            Some("pointer"),
            "la dernière tient jusqu'à la fin"
        );
    }

    /// Le lissage déplace la trajectoire, pas la chronologie : les états doivent survivre
    /// intacts à `smoothed()`, comme les clics.
    #[test]
    fn smoothing_preserves_cursor_types() {
        let track = CursorTrack::new(
            vec![(0.0, 0.0, 0.0), (0.5, 0.4, 0.4), (1.0, 1.0, 1.0)],
            vec![0.25],
            vec![(0.0, "arrow".into()), (0.6, "text".into())],
        );

        let smoothed = track.smoothed(0.4);
        assert_eq!(smoothed.type_at(0.1), Some("arrow"));
        assert_eq!(smoothed.type_at(0.7), Some("text"));
    }

    #[test]
    fn load_preserves_hidden_intervals_and_ignores_hidden_clicks() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "openscreen-cursor-visibility-{}-{}.json",
            std::process::id(),
            unique
        ));
        std::fs::write(
            &path,
            r#"{"samples":[
                {"timeMs":0,"cx":0.1,"cy":0.1,"visible":true},
                {"timeMs":100,"cx":0.2,"cy":0.2,"visible":false,"interactionType":"click"},
                {"timeMs":600,"cx":0.9,"cy":0.9,"visible":true,"interactionType":"click"}
            ]}"#,
        )
        .expect("write temp sidecar");
        let path_str = path.to_str().expect("utf-8 temp path");
        let track = CursorTrack::load(path_str, 0.0, 1.0).expect("load sidecar");
        let clipped = CursorTrack::load(path_str, 200.0, 0.5).expect("load clipped sidecar");
        let _ = std::fs::remove_file(&path);

        assert!(track.visible_at(0.0));
        assert!(!track.visible_at(0.1));
        assert!(!track.visible_at(0.59));
        assert!(track.visible_at(0.6));
        assert_eq!(
            track.clicks,
            vec![0.6],
            "le clic masqué ne doit pas animer le curseur"
        );
        assert!(
            !clipped.visible_at(0.0),
            "la fenêtre commence dans la phase masquée"
        );
        assert!(
            !clipped.visible_at(0.39),
            "l'état masqué tient jusqu'à la transition"
        );
        assert!(
            clipped.visible_at(0.4),
            "la transition visible garde son temps relatif"
        );

        let smoothed = track.smoothed(0.5);
        assert!(
            !smoothed.visible_at(0.3),
            "le lissage garde la phase masquée"
        );
        assert!(smoothed.visible_at(0.6));
        let reappeared = smoothed.at(0.6).expect("position at reappearance");
        assert!(
            (reappeared.0 - 0.9).abs() < 0.02 && (reappeared.1 - 0.9).abs() < 0.02,
            "le ressort redémarre au point visible, sans traîne: {reappeared:?}"
        );
    }

    #[test]
    fn legacy_tracks_without_visibility_stay_visible() {
        let track = CursorTrack::new(vec![(0.0, 0.1, 0.1), (1.0, 0.9, 0.9)], vec![], vec![]);
        assert!(track.visible_at(0.0));
        assert!(track.visible_at(0.5));
        assert!(track.visible_at(10.0));
    }

    /// JSON null et une clé `cursorType` absente resetent vers la flèche,
    /// au lieu de garder le dernier `pointer`/`text`.
    #[test]
    fn null_cursor_type_resets_to_arrow() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "openscreen-cursor-null-reset-{}-{}.json",
            std::process::id(),
            unique
        ));
        std::fs::write(
            &path,
            r#"{"samples":[
                {"timeMs":0,"cx":0.1,"cy":0.1,"cursorType":"pointer"},
                {"timeMs":100,"cx":0.2,"cy":0.2,"cursorType":null},
                {"timeMs":200,"cx":0.3,"cy":0.3,"cursorType":"pointer"},
                {"timeMs":300,"cx":0.4,"cy":0.4}
            ]}"#,
        )
        .expect("write temp sidecar");
        let path_str = path.to_str().expect("utf-8 temp path");
        let track = CursorTrack::load(path_str, 0.0, 1.0).expect("load sidecar");
        let _ = std::fs::remove_file(&path);

        assert_eq!(track.type_at(0.00), Some("pointer"));
        assert_eq!(
            track.type_at(0.10),
            Some("arrow"),
            "JSON null must reset to arrow"
        );
        assert_eq!(
            track.type_at(0.20),
            Some("pointer"),
            "pointer after null must hold until the omitted-key sample"
        );
        assert_eq!(
            track.type_at(0.30),
            Some("arrow"),
            "omitted cursorType after pointer must reset to arrow independently"
        );
    }

    /// A sidecar written to a temp file for one test, removed when the test ends.
    struct TempSidecar(std::path::PathBuf);

    impl TempSidecar {
        /// A path nothing has been written to: a take recorded without a pointer.
        fn missing(tag: &str) -> TempSidecar {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            TempSidecar(std::env::temp_dir().join(format!(
                "openscreen-cursor-patch-{tag}-{}-{unique}.mp4.cursor.json",
                std::process::id()
            )))
        }

        fn write(tag: &str, json: &str) -> TempSidecar {
            let sidecar = TempSidecar::missing(tag);
            std::fs::write(&sidecar.0, json).expect("write temp sidecar");
            sidecar
        }

        fn path(&self) -> &str {
            self.0.to_str().expect("utf-8 temp path")
        }

        /// The screen video this file is the sidecar of.
        fn screen_path(&self) -> &str {
            self.path().strip_suffix(".cursor.json").expect("sidecar suffix")
        }
    }

    impl Drop for TempSidecar {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// A cursor patch as the scene JSON carries it, so these tests read the app's own shape.
    fn patch(start_ms: u32, end_ms: u32, samples: &str) -> SceneCursorPatch {
        serde_json::from_str(&format!(
            r#"{{"screenPath":"/take.mp4","startMs":{start_ms},"endMs":{end_ms},"samples":[{samples}]}}"#
        ))
        .expect("patch json")
    }

    fn assert_at(track: &CursorTrack, t: f32, want: (f32, f32)) {
        let got = track.at(t).expect("position");
        assert!(
            (got.0 - want.0).abs() < 1e-5 && (got.1 - want.1).abs() < 1e-5,
            "t = {t}: {got:?}, expected {want:?}"
        );
    }

    /// Inside the span the pointer is the patch's, ends included; outside it is the recording's,
    /// and the join between the two is an ordinary interpolation.
    #[test]
    fn a_patch_replaces_the_recording_over_its_span_and_nowhere_else() {
        let sidecar = TempSidecar::write(
            "span",
            r#"{"samples":[
                {"timeMs":0,"cx":0.0,"cy":0.1},
                {"timeMs":1000,"cx":0.1,"cy":0.1},
                {"timeMs":1500,"cx":0.15,"cy":0.99},
                {"timeMs":1800,"cx":0.18,"cy":0.99,"interactionType":"click"},
                {"timeMs":2500,"cx":0.25,"cy":0.99},
                {"timeMs":3000,"cx":0.3,"cy":0.1},
                {"timeMs":3500,"cx":0.35,"cy":0.1,"interactionType":"click"},
                {"timeMs":4000,"cx":0.4,"cy":0.1}
            ]}"#,
        );
        let drawn = patch(
            1500,
            2500,
            r#"{"timeMs":1500,"cx":0.8,"cy":0.8,"visible":true,"interactionType":"move"},
               {"timeMs":2200,"cx":0.8,"cy":0.6,"visible":true,"interactionType":"click"},
               {"timeMs":2280,"cx":0.8,"cy":0.6,"visible":true,"interactionType":"mouseup"},
               {"timeMs":2500,"cx":0.9,"cy":0.6,"visible":true,"interactionType":"move"}"#,
        );
        let recorded = CursorTrack::load(sidecar.path(), 0.0, 10.0).expect("recorded");
        let track = CursorTrack::load_patched(sidecar.path(), &[&drawn], 0.0, 10.0).expect("patched");

        // Outside the span: the recording, untouched.
        for t in [0.0, 0.5, 1.0, 3.0, 3.2, 4.0] {
            assert_at(&track, t, recorded.at(t).unwrap());
        }
        // Inside it, both ends included: the patch. The recorded samples at 1500 and 2500 sit
        // exactly on the ends and are gone with the rest.
        assert_at(&track, 1.5, (0.8, 0.8));
        assert_at(&track, 1.85, (0.8, 0.7));
        assert_at(&track, 2.2, (0.8, 0.6));
        assert_at(&track, 2.5, (0.9, 0.6));
        // Into and out of the span: a straight line between a recorded sample and a patch one.
        assert_at(&track, 1.25, (0.45, 0.45));
        assert_at(&track, 2.75, (0.6, 0.35));
        // 3 recorded samples out, 4 patch samples in.
        assert_eq!(track.sample_count(), recorded.sample_count() + 1);

        // The recorded click of the span is gone, the patch's is there, and the recorded click
        // after the span is still there. A release is not a click.
        assert_eq!(recorded.clicks, vec![1.8, 3.5]);
        assert_eq!(track.clicks, vec![2.2, 3.5]);
        assert_eq!(track.click_points[0], (0.8, 0.6));
    }

    /// A hidden patch hides the pointer over its span only: the recording's own visibility is
    /// back with the first recorded sample after it.
    #[test]
    fn a_hidden_patch_hides_the_pointer_over_its_span_only() {
        let sidecar = TempSidecar::write(
            "hidden",
            r#"{"samples":[
                {"timeMs":0,"cx":0.1,"cy":0.1,"visible":true},
                {"timeMs":1500,"cx":0.2,"cy":0.2,"visible":true,"interactionType":"click"},
                {"timeMs":2033,"cx":0.3,"cy":0.3,"visible":true},
                {"timeMs":3000,"cx":0.4,"cy":0.4,"visible":true}
            ]}"#,
        );
        let hidden = patch(
            1000,
            2000,
            r#"{"timeMs":1000,"cx":0.5,"cy":0.5,"visible":false,"interactionType":"move"},
               {"timeMs":1700,"cx":0.5,"cy":0.5,"visible":false,"interactionType":"click"},
               {"timeMs":2000,"cx":0.5,"cy":0.5,"visible":false,"interactionType":"move"}"#,
        );
        let track = CursorTrack::load_patched(sidecar.path(), &[&hidden], 0.0, 10.0).expect("patched");

        assert!(track.visible_at(0.0));
        assert!(track.visible_at(0.999));
        assert!(!track.visible_at(1.0));
        assert!(!track.visible_at(1.5));
        assert!(!track.visible_at(2.0));
        assert!(!track.visible_at(2.03), "hidden until the recording says otherwise");
        assert!(track.visible_at(2.033), "the next recorded sample brings its own state back");
        assert!(track.visible_at(3.0));
        // A hidden press animates nothing, in a patch as in a recording, and the recorded
        // click it replaced is gone.
        assert!(track.clicks.is_empty(), "{:?}", track.clicks);

        // A window that starts inside the span starts hidden: the state at its offset is read
        // from the patched list, not from the recording, which was visible there.
        let clipped = CursorTrack::load_patched(sidecar.path(), &[&hidden], 1500.0, 1.0).expect("clipped");
        assert!(!clipped.visible_at(0.0));
        assert!(!clipped.visible_at(0.5));
        assert!(clipped.visible_at(0.533));
        assert_at(&clipped, 0.2, (0.5, 0.5));
        let recorded = CursorTrack::load(sidecar.path(), 1500.0, 1.0).expect("recorded");
        assert!(recorded.visible_at(0.0));
    }

    /// A patched stretch draws the arrow: a `pointer` recorded before it does not stick to it,
    /// and the recording's type is back with its next sample.
    #[test]
    fn a_patched_span_reads_as_arrow_until_the_recording_resumes() {
        let sidecar = TempSidecar::write(
            "type",
            r#"{"samples":[
                {"timeMs":0,"cx":0.1,"cy":0.1,"cursorType":"pointer"},
                {"timeMs":500,"cx":0.1,"cy":0.1,"cursorType":"pointer"},
                {"timeMs":1500,"cx":0.2,"cy":0.2,"cursorType":"text"},
                {"timeMs":2500,"cx":0.3,"cy":0.3,"cursorType":"pointer"},
                {"timeMs":3000,"cx":0.4,"cy":0.4,"cursorType":"pointer"}
            ]}"#,
        );
        let drawn = patch(
            1000,
            2000,
            r#"{"timeMs":1000,"cx":0.5,"cy":0.5,"visible":true,"interactionType":"move"},
               {"timeMs":2000,"cx":0.6,"cy":0.6,"visible":true,"interactionType":"move"}"#,
        );
        let track = CursorTrack::load_patched(sidecar.path(), &[&drawn], 0.0, 10.0).expect("patched");

        assert_eq!(track.type_at(0.0), Some("pointer"));
        assert_eq!(track.type_at(0.99), Some("pointer"));
        assert_eq!(track.type_at(1.0), Some("arrow"));
        assert_eq!(track.type_at(1.5), Some("arrow"), "the recorded `text` of the span is gone");
        assert_eq!(track.type_at(2.0), Some("arrow"));
        assert_eq!(track.type_at(2.49), Some("arrow"), "a step function: it holds to the next sample");
        assert_eq!(track.type_at(2.5), Some("pointer"));
        assert_eq!(track.type_at(3.0), Some("pointer"));
    }

    /// A patch with no sample only cuts its span out: the track crosses it in a straight line,
    /// from the last recorded sample before to the first one after.
    #[test]
    fn an_empty_patch_interpolates_across_its_span() {
        let sidecar = TempSidecar::write(
            "empty",
            r#"{"samples":[
                {"timeMs":0,"cx":0.0,"cy":0.0},
                {"timeMs":1000,"cx":0.2,"cy":0.2},
                {"timeMs":1400,"cx":0.9,"cy":0.9,"interactionType":"click"},
                {"timeMs":1600,"cx":0.9,"cy":0.1,"visible":false},
                {"timeMs":2000,"cx":0.4,"cy":0.6}
            ]}"#,
        );
        let cut = patch(1200, 1800, "");
        let track = CursorTrack::load_patched(sidecar.path(), &[&cut], 0.0, 10.0).expect("patched");

        assert_eq!(track.sample_count(), 3);
        assert_at(&track, 1.0, (0.2, 0.2));
        assert_at(&track, 1.25, (0.25, 0.3));
        assert_at(&track, 1.5, (0.3, 0.4));
        assert_at(&track, 2.0, (0.4, 0.6));
        assert!(track.clicks.is_empty());
        assert!(track.visible_at(1.6), "the hidden sample went with the span");
    }

    /// Patches are applied as given: out of order, touching or overlapping, each cuts the
    /// recording over its own span and every sample of every patch is drawn, in time order.
    #[test]
    fn patches_are_tolerated_in_any_order() {
        let sidecar = TempSidecar::write(
            "order",
            r#"{"samples":[
                {"timeMs":0,"cx":0.0,"cy":0.0},
                {"timeMs":1500,"cx":0.99,"cy":0.99},
                {"timeMs":2500,"cx":0.99,"cy":0.99},
                {"timeMs":3500,"cx":0.99,"cy":0.99},
                {"timeMs":5000,"cx":0.5,"cy":0.5}
            ]}"#,
        );
        let sample = |time_ms: u32, at: f32| {
            format!(r#"{{"timeMs":{time_ms},"cx":{at},"cy":{at},"visible":true,"interactionType":"move"}}"#)
        };
        // The later span first; the two share the instant 2000; a third overlaps both.
        let later = patch(2000, 3000, &format!("{},{}", sample(2000, 0.2), sample(3000, 0.3)));
        let earlier = patch(1000, 2000, &format!("{},{}", sample(1000, 0.1), sample(2000, 0.2)));
        let across = patch(1800, 3600, &sample(3600, 0.36));
        let track = CursorTrack::load_patched(sidecar.path(), &[&later, &earlier, &across], 0.0, 10.0)
            .expect("patched");

        // 2 recorded samples left, 5 patch samples in.
        assert_eq!(track.sample_count(), 7);
        let times: Vec<f32> = track.samples.iter().map(|s| s.0).collect();
        assert_eq!(times, [0.0, 1.0, 2.0, 2.0, 3.0, 3.6, 5.0]);
        assert_at(&track, 1.0, (0.1, 0.1));
        assert_at(&track, 1.5, (0.15, 0.15));
        assert_at(&track, 2.0, (0.2, 0.2));
        assert_at(&track, 2.5, (0.25, 0.25));
        assert_at(&track, 3.0, (0.3, 0.3));
        assert_at(&track, 3.5, (0.35, 0.35));
    }

    /// A take recorded without a pointer gets one from its patches: the track is their samples
    /// and nothing else. An unreadable sidecar is the same case.
    #[test]
    fn a_missing_sidecar_with_a_patch_yields_the_patch_alone() {
        let drawn = patch(
            1000,
            2000,
            r#"{"timeMs":1000,"cx":0.2,"cy":0.2,"visible":true,"interactionType":"move"},
               {"timeMs":1500,"cx":0.4,"cy":0.2,"visible":true,"interactionType":"click"},
               {"timeMs":2000,"cx":0.6,"cy":0.2,"visible":true,"interactionType":"move"}"#,
        );
        let missing = TempSidecar::missing("absent");
        let broken = TempSidecar::write("broken", "{ not json");
        let shapeless = TempSidecar::write("shapeless", r#"{"version":2}"#);
        for sidecar in [&missing, &broken, &shapeless] {
            let track = CursorTrack::load_patched(sidecar.path(), &[&drawn], 0.0, 10.0)
                .expect("the patch alone is a track");
            assert_eq!(track.sample_count(), 3);
            assert_at(&track, 1.25, (0.3, 0.2));
            assert_at(&track, 2.0, (0.6, 0.2));
            // Held at its ends, like any track.
            assert_at(&track, 0.0, (0.2, 0.2));
            assert_at(&track, 9.0, (0.6, 0.2));
            assert_eq!(track.clicks, vec![1.5]);
            assert_eq!(track.type_at(1.0), Some("arrow"));
            assert!(track.visible_at(1.5));
        }
        // The same through the door the preview and the export use, which finds the sidecar
        // beside the screen video.
        let track = CursorTrack::load_take(missing.screen_path(), &[&drawn]).expect("take");
        assert_eq!(track.sample_count(), 3);
        assert_at(&track, 1.5, (0.4, 0.2));
    }

    /// Without a patch nothing changed: no sidecar, no track.
    #[test]
    fn a_missing_sidecar_without_a_patch_is_still_no_track() {
        let missing = TempSidecar::missing("none");
        assert!(CursorTrack::load(missing.path(), 0.0, 10.0).is_err());
        assert!(CursorTrack::load_patched(missing.path(), &[], 0.0, 10.0).is_err());
        assert!(CursorTrack::load_take(missing.screen_path(), &[]).is_err());
        let broken = TempSidecar::write("none-broken", "{ not json");
        assert!(CursorTrack::load_take(broken.screen_path(), &[]).is_err());
    }

    /// `load_take` reads the sidecar beside the screen video, over the whole recording, and
    /// without a patch it is the recording as `load` gives it.
    #[test]
    fn load_take_reads_the_sidecar_beside_the_screen_video() {
        let sidecar = TempSidecar::write(
            "take",
            r#"{"samples":[
                {"timeMs":0,"cx":0.1,"cy":0.1},
                {"timeMs":90000,"cx":0.9,"cy":0.5,"interactionType":"click"}
            ]}"#,
        );
        assert_eq!(cursor_sidecar_path(sidecar.screen_path()), sidecar.path());
        let track = CursorTrack::load_take(sidecar.screen_path(), &[]).expect("take");
        assert_eq!(track.sample_count(), 2);
        assert_at(&track, 45.0, (0.5, 0.3));
        assert_eq!(track.clicks, vec![90.0]);
    }

    /// Deux clics à 60 ms, sur deux points distincts : la pointe se pose sur chacun à son instant, et
    /// passe de l'un à l'autre sans sauter d'une image à l'autre.
    #[test]
    fn close_clicks_on_distinct_points_glide_between_them() {
        let samples = vec![(0.0, 0.2, 0.2), (1.0, 0.2, 0.2), (1.06, 0.6, 0.5), (2.0, 0.6, 0.5)];
        let track = CursorTrack::new(samples, vec![1.0, 1.06], vec![]).smoothed(0.67);
        let (a, b): ((f32, f32), (f32, f32)) = ((0.2, 0.2), (0.6, 0.5));
        assert_eq!(track.pinned_at(1.0), Some(a));
        assert_eq!(track.pinned_at(1.06), Some(b));
        let gap = (b.0 - a.0).hypot(b.1 - a.1);
        for k in 1000..1060 {
            let p = track.pinned_at(k as f32 * 0.001).unwrap();
            let q = track.pinned_at((k + 1) as f32 * 0.001).unwrap();
            let step = (q.0 - p.0).hypot(q.1 - p.1);
            assert!(step < 0.06 * gap, "{k} ms : saut de {step}");
        }
    }

    /// `pinned_at` pose le curseur sur le point BRUT du clic pendant le contact, même quand la
    /// piste lissée traîne loin derrière, reste continue, et rend `at()` loin des clics.
    #[test]
    fn the_pinned_position_holds_the_raw_click_point() {
        // Un geste rapide de 0,1 à 0,7 qui s'arrête pile sur le clic, puis repart vers le bas.
        let samples: Vec<(f32, f32, f32)> = (0..=60)
            .map(|k| {
                let t = k as f32 / 30.0;
                let x = 0.1 + 0.6 * (t / 1.0).min(1.0);
                let y = 0.5 + 0.3 * ((t - 1.0) / 0.3).clamp(0.0, 1.0);
                (t, x, y)
            })
            .collect();
        let raw = CursorTrack::new(samples, vec![1.0], vec![]);
        let clicked = raw.at(1.0).unwrap();
        for track in [raw.smoothed(0.0), raw.smoothed(0.5), raw.smoothed(1.0)] {
            let lag = track.at(1.0).unwrap();
            for ms in 0..=100 {
                let t = 1.0 + ms as f32 / 1000.0;
                assert_eq!(track.pinned_at(t), Some(clicked), "{ms} ms après le clic");
            }
            // Loin des clics : la piste telle quelle.
            for t in [0.5, 0.74, 1.36, 1.8] {
                assert_eq!(track.pinned_at(t), track.at(t), "t = {t}");
            }
            // Continue : pas de saut d'une milliseconde à l'autre.
            for k in 0..2000 {
                let (a, b) = (
                    track.pinned_at(k as f32 * 0.001).unwrap(),
                    track.pinned_at((k + 1) as f32 * 0.001).unwrap(),
                );
                assert!(
                    (a.0 - b.0).abs() < 4e-3 && (a.1 - b.1).abs() < 4e-3,
                    "saut en {k} ms : {a:?} -> {b:?}"
                );
            }
            println!("au clic, piste en {lag:?}, point cliqué {clicked:?}");
        }
        // Le lissage traîne bel et bien : sans la convergence, le contact tomberait à côté.
        assert!(raw.smoothed(0.5).at(1.0).unwrap().0 < 0.69);
    }

    /// Enveloppe du click bounce : neutre hors fenêtre, continue aux jonctions, creux à 0.76 et
    /// pic à 1.16 aux bons instants, et un nouveau clic redémarre la courbe.
    #[test]
    fn click_bounce_envelope() {
        let near = |a: f32, b: f32, tol: f32| (a - b).abs() < tol;
        let track = CursorTrack::new(vec![], vec![1.0], vec![]);
        let b = |t: f32| track.bounce(t);

        // Exactement neutre avant le premier clic et après la fenêtre de 260 ms.
        assert_eq!(b(0.0), 1.0);
        assert_eq!(b(0.999), 1.0);
        assert_eq!(b(1.2601), 1.0);
        assert_eq!(b(5.0), 1.0);

        // Continuité aux jonctions (fraction 0, 0.38 et 1) : ±0.1 ms autour reste à ~1.
        const DT: f32 = 1e-4;
        assert_eq!(b(1.0), 1.0, "fraction 0");
        assert!(near(b(1.0 + DT), 1.0, 2e-3));
        let press_end = 1.0 + 0.38 * 0.26;
        assert!(
            near(b(press_end - DT), 1.0, 2e-3),
            "fraction 0.38⁻ : {}",
            b(press_end - DT)
        );
        assert!(
            near(b(press_end + DT), 1.0, 2e-3),
            "fraction 0.38⁺ : {}",
            b(press_end + DT)
        );
        assert!(
            near(b(1.26 - DT), 1.0, 2e-3),
            "fraction 1⁻ : {}",
            b(1.26 - DT)
        );

        // Creux de la pression (fraction 0.19 → +49.4 ms), pic du rebond (0.69 → +179.4 ms).
        assert!(near(b(1.0494), 0.76, 1e-4), "creux : {}", b(1.0494));
        assert!(near(b(1.1794), 1.16, 1e-4), "pic : {}", b(1.1794));
        assert!(b(1.03) > 0.76 && b(1.07) > 0.76, "le creux est un minimum");
        assert!(b(1.15) < 1.16 && b(1.21) < 1.16, "le pic est un maximum");

        // Seul le clic le plus récent compte : le second redémarre la courbe. À 1.1 s le premier
        // serait encore dans son rebond (≈1.0037), le second l'écrase à 1.0 pile.
        let double = CursorTrack::new(vec![], vec![1.0, 1.1], vec![]);
        assert_eq!(double.bounce(1.1), 1.0, "redémarrage à la fraction 0");
        assert!(
            near(double.bounce(1.1494), 0.76, 1e-4),
            "nouveau creux : {}",
            double.bounce(1.1494)
        );
        assert!(
            near(double.bounce(1.2794), 1.16, 1e-4),
            "nouveau pic : {}",
            double.bounce(1.2794)
        );
        assert_eq!(
            double.bounce(1.3601),
            1.0,
            "neutre après la fenêtre du second clic"
        );
    }

    #[test]
    fn auto_hide_disabled_always_full_opacity() {
        let track = CursorTrack::new(vec![(0.0, 0.5, 0.5), (10.0, 0.5, 0.5)], vec![], vec![]);
        assert_eq!(track.opacity_at(0.0, false), 1.0);
        assert_eq!(track.opacity_at(5.0, false), 1.0);
        assert_eq!(track.opacity_at(10.0, false), 1.0);
    }

    #[test]
    fn auto_hide_fades_out_after_idle_timeout() {
        // Le curseur est stationnaire à (0.5, 0.5) de 0 à 5s.
        let track = CursorTrack::new(
            vec![
                (0.0, 0.5, 0.5),
                (1.0, 0.5, 0.5),
                (2.0, 0.5, 0.5),
                (3.0, 0.5, 0.5),
                (4.0, 0.5, 0.5),
            ],
            vec![],
            vec![],
        );
        // Pendant 1.5s, opacité 1.0
        assert_eq!(track.opacity_at(0.0, true), 1.0);
        assert_eq!(track.opacity_at(1.0, true), 1.0);
        assert_eq!(track.opacity_at(1.5, true), 1.0);

        // Entre 1.5s et 1.8s, estompage linéaire
        let op_mid = track.opacity_at(1.65, true);
        assert!(
            (op_mid - 0.5).abs() < 0.05,
            "mi-parcours d'estompage: {op_mid}"
        );

        // À 1.8s et au-delà, opacité 0.0
        assert_eq!(track.opacity_at(1.8, true), 0.0);
        assert_eq!(track.opacity_at(3.0, true), 0.0);
    }

    #[test]
    fn auto_hide_wakes_on_movement_or_click() {
        // Reste immobile jusqu'à 2s, bouge à 2.5s, s'arrête, clic à 4.0s
        let track = CursorTrack::new(
            vec![
                (0.0, 0.1, 0.1),
                (1.0, 0.1, 0.1),
                (2.0, 0.1, 0.1),
                (2.5, 0.8, 0.8), // mouvement net
                (2.6, 0.8, 0.8),
                (4.0, 0.8, 0.8),
                (5.0, 0.8, 0.8),
            ],
            vec![4.0], // clic à 4.0s
            vec![],
        );

        // À 1.9s, inactif depuis 0s -> 0.0
        assert_eq!(track.opacity_at(1.9, true), 0.0);

        // À 2.5s, vient de bouger -> réveil à 1.0
        assert_eq!(track.opacity_at(2.5, true), 1.0);
        // À 3.5s, 1s après le mouvement -> toujours 1.0
        assert_eq!(track.opacity_at(3.5, true), 1.0);

        // Sans le clic à 4.0, à 4.5s (2s après 2.5) il serait éteint.
        // Mais le clic à 4.0s le réveille -> 1.0
        assert_eq!(track.opacity_at(4.2, true), 1.0);
        // Et s'éteint 1.8s après le clic (4.0 + 1.8 = 5.8s)
        assert_eq!(track.opacity_at(5.9, true), 0.0);
    }
}
