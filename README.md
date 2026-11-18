# LuthiersPen

<!-- site-summary:start -->
<!-- This section is this project's card on https://mendus59.github.io and is copied there daily.
     Keep it true of what's on main: one plain-text summary line (max 160 characters), then 1-6 short bullets.
     See CLAUDE.md ("Site summary"). -->
Turn a solo guitar recording into classical guitar sheet music you can play back, check against the original and edit, all in the browser.

- Transcribe an audio or MP4 video file (all of it or a chosen part), a YouTube video played in the page, or your microphone into classical guitar notation.
- Scores are engraved like a published edition: the key found by ear and its signature, notation over tablature, two voices, fingerings, string numbers, barres and chord names.
- Play the score with a moving cursor, tempo control, looping, metronome and count-in, or hear the original recording in step with it.
- Check every written note against the recording, and compare the arrangement with the composer's original score to find missing melody notes and stray ones.
- Edit any note, rhythm or fingering, or write a new score from scratch, with undo and keyboard shortcuts.
- Sign in with Google or email to save scores to your library, and export to PDF, MIDI or Guitar Pro.
<!-- site-summary:end -->

**Open the app: https://mendus59.github.io/LuthiersPen/**

## How it works

Everything runs in the browser; the site is static and hosted on GitHub Pages.

| Step | What happens | Where |
| --- | --- | --- |
| Listen | Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) model (TensorFlow.js), with its final layers retrained on the guitar lesson videos below, proposes candidate notes, more of them than it is sure of. A small model of decision trees, fitted on those videos and 52 more lessons from the same channel, then decides which were really played, from how the detector rated each candidate, how its partials rise in the recording at its onset, and the candidates around it. Each candidate is then judged again against the same spot in passages that repeat, so a phrase that comes back is written the same way where the playing allows. This keeps soft and re-plucked notes while leaving out strings that are merely still ringing, overtones, and one pluck heard twice. | `src/transcribe/detect.ts`, `features.ts`, `filter.ts`, `note-model.json`, `repeats.ts` |
| Find the beat | A dynamic-programming beat tracker finds the pulse, and the meter is heard from how often the bass returns (4/4, 3/4 or 3/8). | `src/transcribe/tempo.ts` |
| Find the bars | The barlines are then found bar by bar rather than beat by beat: a bar-sized template is fitted along the performance, scoring each possible downbeat with a small model learned from the lesson videos below (bass and chord changes, the lowest note around, longer notes, a breath before it) and the notes inside the bar by how evenly they fall on its beats. Bars may stretch and shrink from one to the next, so a player who lingers or presses on keeps the barlines in place, and a pause is picked up again after it. A bar two or three beats short (a 2/4 bar inside 4/4) is allowed at a cost, and printed with its own time signature. Swung eighths are heard and written straight under a *Swing* mark. | `src/transcribe/bars.ts`, `downbeat-model.json` |
| Write it down | Notes are quantized and split into two voices as an edition prints them: the bass voice holds only the notes that carry the harmony and lets them ring to the next one or the barline, while everything above runs on in the upper voice. | `src/transcribe/quantize.ts` |
| Finger it | A search over left-hand positions chooses a string and fret for every note, then adds fingerings, string numbers, and barre and position marks where an edition would print them. | `src/transcribe/fingering.ts` |
| Engrave and play | [alphaTab](https://alphatab.net) draws the notation and plays it with a nylon-guitar soundfont. | `src/model/toAlphaTab.ts`, `src/components/ScoreView.tsx` |
| Check | Each note the score will play is looked up in the recording at that moment (its partials must stand clear of the neighbouring semitones), and each note heard must be in the score. | `src/verify/` |
| Compare | The original score is lined up with the arrangement by the pitch classes sounding in each sixteenth (dynamic time warping, any key, note values halved or doubled, rubato), then its melody and bass are looked for in the arrangement and every arranged note is looked for in the original. | `src/compare/` |

### Video files

An MP4 (or MOV/WebM) video can be chosen like an audio file; only its sound is read. *From* and *To* limit the transcription to part of the recording, for example the performance at the start of a lesson video without the slow walkthrough and its metronome.

### YouTube

A static website cannot download the audio of a YouTube video. Instead the video plays inside the page and the browser records the tab's sound, with your permission: choose *this tab* and keep *Also share tab audio* on. This takes as long as the video and needs Chrome or Edge on a computer.

### Comparing with the original

Guitar arrangements of classical pieces are interpretations: they change key, thin the accompaniment and sometimes leave passages out. *Compare* reads the composer's original score (MusicXML, .mxl or Guitar Pro, for example a MuseScore or IMSLP export), finds the key, the note values and the passages the arrangement covers, and lists:

- melody notes of the original that the arrangement doesn't play, each with an *Add* button that writes it into the score in the arrangement's key and octave;
- notes of the arrangement that nothing in the original supports at that moment, which are often transcription errors or slips in the recording, each with a *Remove* button;
- bass notes left out, kept apart because arrangements often thin the bass.

On a transcription of a guitar recording of Für Elise against Beethoven's piano score, it finds the same key, 92% of the melody and 27 notes (3%) the original doesn't have. Repeats in the original are written out. If the original is a single line (a melody or lead sheet), only the melody is compared.

### Measured accuracy

Checked against the tablature shown in 15 guitar lesson videos, whole performances at full speed, 9,452 notes in all. The tablature is read from the video automatically and the written pitches are compared with it in order.

| | Notes found | Written notes correct |
|---|---|---|
| Note model also fitted on 52 more lesson videos, with the repeat check (as shipped) | 94.5% | 96.9% |
| Guitar-trained detector, note model and repeat check | 94.5% | 96.6% |
| The same without the repeat check | 94.5% | 96.1% |
| Original detector with the previous note model | 94.2% | 95.9% |
| First note model, fitted on the opening bars of four videos | 93.6% | 92.0% |

Each video is scored by a detector and a note model that never heard it (the 52 extra lessons are used only for fitting, never for scoring), so these figures are a fair guide to a new recording; on the 15 videos themselves the shipped app does better. Accuracy varies by piece, from about 87% of notes found in dense strummed chords and fast repeated notes to 98% in clear arpeggios. About 2% of the notes are never proposed by the detector at all, so no filter can recover them. Rhythm, voices and fingering are not part of these figures.

### Limits worth knowing

- Transcription is a draft, not an edition. Expect to correct rhythms, voices and fingerings, especially in fast or dense passages.
- Only 4/4, 3/4 and 3/8 are recognised by ear; pick any other time signature from the list (6/8 and 12/8 are followed bar by bar once chosen). Repeats are written out.
- Barlines land where the tablature has them in about two measures out of three over the lesson videos (66%, up from 50%, each video judged by a downbeat model that never heard it). Slow pieces felt in eighths (a quarter near 60) often come out in half-length measures; choose *Beat: Half as fast* to fix them. A bar of another length inside a piece (a 2/4 bar in 4/4) is written with its own time signature where the tracker is confident, which is seldom; any measure's time signature can be changed by hand in *Edit*.
- The smallest note value is a sixteenth; triplets are not detected automatically (they can be entered by hand).
- The check confirms that the written pitches are in the recording at the right time. It cannot tell a ringing string from one plucked again, or an octave doubling from an overtone.
- The original recording stays in the browser session; only the score is saved to your library.

## Firebase setup

Sign-in and the score library use the `luthierspen` Firebase project (`src/firebase.ts`). In the Firebase console:

1. Authentication, Sign-in method: enable **Google** and **Email/Password**.
2. Authentication, Settings, Authorized domains: add `mendus59.github.io`.
3. Firestore Database: create a database and publish the rules in [`firestore.rules`](firestore.rules), which give each signed-in user access to their own scores only.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/LuthiersPen/
npm test         # pipeline tests
npm run build    # production build in dist/
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). The repository's Pages source must be set to **GitHub Actions**.
