# igloo-pwa — User Guide

> ⚠️ **Public beta.** This software handles private key material and is
> self-audited (no independent external audit yet). Prefer test keys/funds, keep
> independent backups of your shares, and report security issues via the
> repository's **Security** tab.

## What igloo-pwa is

igloo-pwa is a browser-based **signing device** for FROSTR. FROSTR splits a
single Nostr identity key into several **shares** using a threshold scheme: a
keyset of *N* shares with a threshold *T* means **any *T* of the *N* shares**
must cooperate to sign — no single device ever holds the whole key.

This app holds **one share** on your device and cooperates with your other
devices/peers (over Nostr relays) to produce signatures. Your share is stored
**encrypted on your device**; it is never uploaded in the clear.

## Requirements

- A modern, up-to-date browser (Chromium, Firefox, or Safari).
- The app served over **HTTPS** (the hosted beta URL).
- Network access to your keyset's relays (which must be `wss://`).

## Installing

1. Open the hosted app URL in your browser.
2. Optionally **install it as an app**: use your browser's "Install app" / "Add
   to Home Screen" option. It runs the same either way; installing just gives it
   its own window/icon.

There is no account and no sign-up — everything lives on your device.

## First-time setup

You will either **create a new keyset** or **onboard this device** into an
existing one.

### Create a new keyset
Choose this if you are setting up FROSTR for the first time.
1. Name the keyset and choose the threshold and total shares (e.g. **2 of 3**).
   (You can also import an existing `nsec` to split, instead of generating a new
   key.)
2. The app generates the shares. **One share is saved to this device**; the
   others become **onboarding packages** to distribute to your other
   devices/co-signers.
3. Set a **profile password** (see below) to encrypt this device's share.

### Onboard this device
Choose this if someone has sent you an **onboarding package** (a `bfonboard…`
string) for an existing keyset.
1. Paste the onboarding package and its password.
2. Review the keyset details (name, threshold, your share) and set a **profile
   password** for this device.

## Your profile password

The profile password **encrypts your share on this device** and is required to
**unlock** the app each session.

- It is **not** recoverable if forgotten — there is no reset link.
- Forgetting it does **not** mean losing the keyset: as long as a **threshold of
  shares** still exists across your devices/co-signers, the key can be recovered
  (see below). But you would lose *this device's* access until you re-onboard.
- Choose a strong, unique passphrase and store it in a password manager.

## Unlocking and signing

Each session, enter your profile password to unlock. Once unlocked, the signer
runs in the page and cooperates with your peers to sign requests. Closing the
tab stops the signer; reopening requires unlocking again.

## Recovery — "I lost a device or forgot a password"

Recovery reconstructs the **group secret key** (the full `nsec`) from a
**threshold of shares**. Use it to migrate or to rebuild access.

1. Go to the **Recover** flow.
2. Provide enough shares to meet the threshold:
   - Normally: this device's share (unlock it with its passphrase) **plus**
     pasted share packages from other members, until the threshold is met.
   - **Lost-device mode:** if this device's share is gone, paste a **full
     threshold** of share packages from the other members.
3. When the threshold is met, the recovered key is shown **masked by default**.
   Reveal it only when you are ready, in a safe place.
4. **Export it safely:** prefer the **encrypted export** (NIP-49 `ncryptsec`,
   protected by a password you choose) over the plaintext `nsec`. The recovered
   key **auto-clears from the screen after ~60 seconds** — re-recover if it
   clears before you finish.

> 🔐 The recovered value is your **complete signing key**. Anyone who obtains it
> controls the identity. Move it straight into an encrypted store and leave the
> recovery screen to clear it from memory.

## Backups — what to keep

- Each device's **share** (and its profile password).
- Your keyset's **group package** (the public keyset definition).
- Remember the **threshold**: you need *T* of *N* shares to recover. Losing more
  than *N − T* shares with no recovery export means the key is unrecoverable.

## Troubleshooting

- **"Incorrect passphrase."** — wrong profile password for this device. There is
  no reset; if it is truly lost, recover via a threshold of shares and
  re-onboard this device.
- **Can't connect / peers not ready** — check that your keyset's relays are
  reachable and use `wss://` (plaintext `ws://` to non-loopback hosts is
  blocked). Signing needs enough peers online to meet the threshold.
- **Runtime error on start** — reload the page (this restarts the signer). If it
  persists, confirm your browser is current and the page is served over HTTPS.

## Security

Report vulnerabilities privately via the repository's **Security** tab (GitHub
Private Vulnerability Reporting). Do not open public issues for security
problems.
