# Rasa Desk

**Rasa Desk** is a remote desktop application for Windows by **Rasa System Advisors Co** (rasasystemco.com): connect to another computer with an ID and a password, transfer files, and get remote support. It works peer-to-peer where possible and falls back to a relay server operated by us.

- **Download:** https://id.rasa-desk.ir/download/ (installers with SHA-256 hashes)
- **Privacy policy:** https://id.rasa-desk.ir/privacy
- **Code signing policy:** https://id.rasa-desk.ir/code-signing-policy
- **Server (ID/relay with fair-use quota):** https://github.com/khashayarbehmanesh-cloud/rasadesk-server

## What is different from the upstream project
This repository is a modified, rebranded build of the open-source remote desktop client it is forked from (see "Origin and license"). Our changes are applied on top of the upstream source by scripts in [`rasadesk/client`](rasadesk/client):

- Branding, icons, Persian-friendly font (Vazirmatn, SIL OFL 1.1) and application metadata
- Built-in server address and key (no dependency on third-party servers; no default API/update servers)
- Ad slots (bottom bar and two right-column slots) fed by our own ad server, with on-disk caching and click-through
- Language picker on the main screen (defaults to the Windows locale)
- Per-installation device ID salt so IDs differ from other applications built from the same upstream
- Update notice / forced-update gate driven by our server
- Windows installer (MSI and single-file exe) branding

## Build
Releases are built **only** by GitHub Actions from this repository (workflow `RasaDesk - Windows build`, file `.github/workflows/rasadesk-windows.yml`). The workflow checks out the source, runs `rasadesk/client/apply-branding.js`, and builds the Windows client, the single-file installer and the MSI. No binaries are built on personal computers.

## Origin and license
Rasa Desk is licensed under the **GNU Affero General Public License v3.0** (see [`LICENCE`](LICENCE)). It is based on the open-source RustDesk project (copyright Purslane Tech Pte. Ltd. and contributors, AGPL-3.0). All upstream copyright and license notices are preserved in the source files and in the application's About page. The complete corresponding source code of every released build is this repository.

"RustDesk" is a trademark of its owner; this project is not affiliated with or endorsed by it.

## Contact
Rasa System Advisors Co — https://rasasystemco.com
