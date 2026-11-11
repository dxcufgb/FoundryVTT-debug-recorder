# Privacy

The recorder only keeps technical data. It removes what could identify your players, your world or your server **when something is stored**, not only when you download, and once more over the whole file when it is built.

## What is removed

- **Names** of users, actors, tokens, items, combatants, combats, scenes, journals and their pages, chat messages, folders, macros, playlists, roll tables, cards, effects, notes and drawings become `‹name›`. Names created or changed during the recording are learnt as well.
- **Chat text and journal text** (text pages up to 20,000 characters each, image and video captions) and the world's description become `‹text›`.
- **The world's title and id** become `[world]`.
- **The server's address**: URLs become `[url]` (paths inside `modules/<id>/` and `systems/<id>/` are kept from there on, so stack frames still point at the code), world file paths become `[world]/<folders>/` without the file name, other paths `[path]`, host names and `host:port` `[host]`, IP addresses `[ip]`, e-mail addresses `[email]`, `data:` URIs `[data-uri]`.
- **Document ids** become pseudonyms per recording (`U1`, `A3`, `S2`…). The same document gets the same pseudonym within a recording, so you can follow it, but the mapping is never written to the file.
- **Keys** such as `name`, `title`, `text`, `content`, `notes`, `description`, `img`, `src`, `password`, `email`, `session` or `apikey` are dropped wherever they appear, whatever they hold.
- **Settings** keep their value only when it is a number, a true/false or one of the setting's own choices; any other text becomes `‹string:N›` (its length). Flags are reported only as the shape of their keys, never their values.
- **Users** appear only as a role and a number ("GM 1", "Player 2").

The name you give a recording and the text you write under **What happened** go through the same removal when they are written to the file or its name.

## What is kept

Versions, ids of modules and systems, Foundry's build, settings without their text, counts, error messages and stack frames (with the removals above), timings, and what the modules report about themselves (which the modules themselves keep to counts, booleans and their own fixed ids).

## Check before you share

The removal is thorough but can't be perfect: names shorter than three characters, for example, are not removed, and text a module puts into an error message is only as clean as the names the recorder knows. So:

- Look at the **Preview** before downloading, and
- open the downloaded file and check it before you attach it to a public issue.

The file ends with **redaction**, a count of everything that was removed, per kind.

## Who sees what

Only GMs can open the recorder, record or download. Players only see the "Debug recording" badge while a recording runs. Nothing is sent anywhere: the file only leaves your computer when you attach it to an issue.
