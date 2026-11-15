# LuthiersPen

<!-- site-summary:start -->
<!-- This section is this project's card on https://mendus59.github.io and is copied there daily.
     Keep it true of what's on main: one plain-text summary line (max 160 characters), then 1-6 short bullets.
     See CLAUDE.md ("Site summary"). -->
Turn a solo guitar recording into classical guitar sheet music you can play back, check against the original and edit, all in the browser.

- Transcribe an audio or MP4 video file (all of it or a chosen part), a YouTube video played in the page, or your microphone into classical guitar notation.
- Scores are engraved like a published edition: notation over tablature, two voices, fingerings, string numbers, barre brackets and chord names.
- Play the score with a moving cursor, tempo control, looping, metronome and count-in, or hear the original recording in step with it.
- Check the transcription: every written note is looked up in the recording, and doubtful notes and measures are marked in the score.
- Edit any note, rhythm or fingering, or write a new score from scratch, with undo and keyboard shortcuts.
- Sign in with Google or email to save scores to your library, and export to PDF, MIDI or Guitar Pro.
<!-- site-summary:end -->

**Open the app: https://mendus59.github.io/LuthiersPen/**

## How it works

Everything runs in the browser; the site is static and hosted on GitHub Pages.

| Step | What happens | Where |
| --- | --- | --- |
| Listen | Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) model (TensorFlow.js) proposes candidate notes, more of them than it is sure of. A small model of decision trees then decides which were really played, from how the detector rated each candidate, how its partials rise in the recording at its onset, and the candidates around it. This keeps soft and re-plucked notes while leaving out strings that are merely still ringing, overtones, and one pluck heard twice. | `src/transcribe/detect.ts`, `features.ts`, `filter.ts`, `note-model.json` |
| Find the beat | A dynamic-programming beat tracker follows the performance, so rubato does not push notes off the grid. | `src/transcribe/tempo.ts` |
| Write it down | The meter is heard from how often the bass returns (4/4, 3/4 or 3/8), and the barlines are kept on the bass even where the player lingers. Notes are then quantized and split into two voices as an edition prints them: the bass voice holds only the notes that carry the harmony and lets them ring to the next one or the barline, while everything above runs on in the upper voice. | `src/transcribe/quantize.ts` |
| Finger it | A search over left-hand positions chooses a string and fret for every note, then adds fingerings, string numbers, and barre and position marks where an edition would print them. | `src/transcribe/fingering.ts` |
| Engrave and play | [alphaTab](https://alphatab.net) draws the notation and plays it with a nylon-guitar soundfont. | `src/model/toAlphaTab.ts`, `src/components/ScoreView.tsx` |
| Check | Each note the score will play is looked up in the recording at that moment (its partials must stand clear of the neighbouring semitones), and each note heard must be in the score. | `src/verify/` |

### Video files

An MP4 (or MOV/WebM) video can be chosen like an audio file; only its sound is read. *From* and *To* limit the transcription to part of the recording, for example the performance at the start of a lesson video without the slow walkthrough and its metronome.

### YouTube

A static website cannot download the audio of a YouTube video. Instead the video plays inside the page and the browser records the tab's sound, with your permission: choose *this tab* and keep *Also share tab audio* on. This takes as long as the video and needs Chrome or Edge on a computer.

### Measured accuracy

Checked against the tablature shown in 15 guitar lesson videos, whole performances at full speed, 9,452 notes in all. The tablature is read from the video automatically and the written pitches are compared with it in order.

| | Notes found | Written notes correct |
|---|---|---|
| Note model fitted on all 15 (as shipped) | 96.4% | 97.8% |
| Each video scored by a model that never saw it | 94.0% | 95.8% |
| Previous note model, fitted on the opening bars of four videos | 93.6% | 92.0% |

The second row is the fairer guide to a new recording. It varies by piece, from about 87% of notes found in dense strummed chords and fast repeated notes to 98% in clear arpeggios. About 2% of the notes are never proposed by the detector at all, so no filter can recover them. Rhythm, voices and fingering are not part of these figures.

### Limits worth knowing

- Transcription is a draft, not an edition. Expect to correct rhythms, voices and fingerings, especially in fast or dense passages.
- Only 4/4, 3/4 and 3/8 are recognised by ear; pick any other time signature from the list. Repeats are written out.
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
