import * as React from 'react';
import * as nip49 from 'nostr-tools/nip49';
import {
  Button,
  CRITICAL_E2E_TEST_IDS,
  PageBackLink,
  PasswordField,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  QrPayloadModal,
  RecoverCollectSharesPanel,
  StepProgress,
} from 'igloo-ui';
import type { useStore } from '../lib/store';
import type { PwaProfile } from '../lib/types';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

const RECOVER_FLOW_STEPS = ['Collect Shares', 'Recover Key'];

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function RecoverPrivateKeyView({
  recovered,
  onClear,
}: {
  recovered: { nsec: string; signingKeyHex: string };
  onClear: () => void;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [encrypt, setEncrypt] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  // Auto-clear the recovered key from memory after 60 seconds (matches the Paper
  // security treatment). The key is never persisted; this is an extra safeguard on
  // top of the navigate-away clear.
  React.useEffect(() => {
    const timer = window.setTimeout(onClear, 60_000);
    return () => window.clearTimeout(timer);
  }, [onClear]);

  // Encrypt Key: when enabled with a valid (non-empty, matching) password, every export
  // emits a NIP-49 `ncryptsec1` instead of the plaintext nsec. The encryption runs in
  // memory only; neither form is ever persisted.
  const passwordsMatch = password === confirmPassword;
  const encryptReady = encrypt && password.length > 0 && passwordsMatch;
  const encryptedKey = React.useMemo(() => {
    if (!encryptReady) return null;
    try {
      return nip49.encrypt(hexToBytes(recovered.signingKeyHex), password);
    } catch {
      return null;
    }
  }, [encryptReady, password, recovered.signingKeyHex]);

  // When Encrypt Key is on, exports are blocked until the password is valid.
  const exportValue = encrypt ? encryptedKey : recovered.nsec;
  const exportsDisabled = encrypt && !encryptedKey;
  const passwordError = encrypt && confirmPassword.length > 0 && !passwordsMatch
    ? 'Passwords do not match.'
    : null;
  const fieldLabel = encrypt ? 'Encrypted Key (ncryptsec)' : 'Recovered NSEC';
  const displayValue = exportValue ?? recovered.nsec;
  // Show only the bech32 HRP (e.g. `nsec1` / `ncryptsec1`) when masked — never any
  // key data — so the recovered key is not partially exposed before an explicit reveal.
  const hrpEnd = displayValue.indexOf('1');
  const masked = `${hrpEnd >= 0 ? displayValue.slice(0, hrpEnd + 1) : ''}${'•'.repeat(32)}`;

  function copyKey() {
    if (!exportValue) return;
    void navigator.clipboard?.writeText(exportValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function saveKey() {
    if (!exportValue) return;
    const blob = new Blob([exportValue], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = encrypt ? 'recovered-key.ncryptsec' : 'recovered-nsec.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={RECOVER_FLOW_STEPS} active={1} />
        <PageBackLink label="Back to Welcome" onBack={onClear} />
        <PublicTaskTitle
          title="Recover Private Key"
          description="Your private key has been recovered. Please handle it with care!"
        />
        <section className="igloo-flow-root igloo-stack">
          <section className="igloo-task-banner">
            <span className="igloo-task-kicker">Security Warning</span>
            <ul>
              <li>Your private key will auto-clear in 60 seconds.</li>
              <li>Do not screenshot or share this key.</li>
              <li>Copy to a secure password manager.</li>
            </ul>
          </section>

          <label>
            {fieldLabel}
            <div className="igloo-recover-key-field">
              <span data-testid={CRITICAL_E2E_TEST_IDS.recoverKeyValue}>
                {revealed ? displayValue : masked}
              </span>
            </div>
          </label>

          <div className="igloo-button-row">
            <Button type="button" size="sm" onClick={copyKey} disabled={exportsDisabled}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={saveKey} disabled={exportsDisabled}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setQrOpen(true)}
              disabled={exportsDisabled}
            >
              QR code
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid={CRITICAL_E2E_TEST_IDS.recoverRevealKey}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClear}>
              Clear
            </Button>
          </div>

          <label className="igloo-recover-encrypt-toggle">
            <input type="checkbox" checked={encrypt} onChange={(event) => setEncrypt(event.target.checked)} />
            <span>
              <strong>Encrypt Key</strong>
              <small>Protect the exported key with a password before saving or sharing.</small>
            </span>
          </label>
          {encrypt ? (
            <div className="igloo-stack">
              <label>
                Password
                <PasswordField value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label>
                Confirm Password
                <PasswordField
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              {passwordError ? <span className="igloo-field-error">{passwordError}</span> : null}
            </div>
          ) : null}
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />

      <QrPayloadModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={encrypt ? 'Encrypted Key (ncryptsec)' : 'Recovered NSEC'}
        payload={exportValue ?? ''}
        label={encrypt ? 'Scan to import the encrypted key' : 'Scan to import the recovered private key'}
      />
    </>
  );
}

export function RecoverCollectView({
  store,
  run,
  selectedProfile,
  onBack,
  onRecovered,
}: {
  store: PwaStore;
  run: RunAction;
  selectedProfile: PwaProfile | null;
  onBack: () => void;
  onRecovered: (recovered: { nsec: string; signingKeyHex: string }) => void;
}) {
  const threshold = (() => {
    try {
      const group = selectedProfile?.group_package_json
        ? (JSON.parse(selectedProfile.group_package_json) as { threshold?: unknown })
        : null;
      return typeof group?.threshold === 'number' && group.threshold > 0 ? group.threshold : 2;
    } catch {
      return 2;
    }
  })();
  const sources = store.drafts.recoverKeyForm.sources;
  const lostDevice = store.draftSecrets.recoverLostDevice;
  const deviceShareValidated = store.draftSecrets.recoverDeviceUnlockVerified;
  const pastedCount = sources.filter((source) => source.packageText.trim().length > 0).length;
  // The device share counts toward the threshold only once its passphrase has
  // actually unlocked it; in lost-device mode it never counts.
  const deviceContribution = lostDevice ? 0 : deviceShareValidated ? 1 : 0;
  const collectedCount = deviceContribution + pastedCount;
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={RECOVER_FLOW_STEPS} active={0} />
        <PageBackLink label="Back to Welcome" onBack={onBack} />
        <PublicTaskTitle
          title="Collect Shares"
          description="Collect enough existing source packages to recover this key. Once the threshold is met, you can reveal and export the recovered private key."
        />
        <section className="igloo-flow-root">
          <RecoverCollectSharesPanel
            devicePassphrase={store.draftSecrets.recoverDevicePassphrase}
            onChangeDevicePassphrase={(value) => store.setRecoverDevicePassphrase(value)}
            lostDeviceMode={lostDevice}
            onToggleLostDevice={(value) => store.setRecoverLostDevice(value)}
            deviceShareValidated={deviceShareValidated}
            onVerifyDevicePassphrase={() => void store.verifyRecoverDeviceUnlock()}
            sources={sources.map((source, index) => ({
              packageText: source.packageText,
              packagePassword: store.draftSecrets.recoverKeySources[index] ?? '',
            }))}
            threshold={threshold}
            collectedCount={collectedCount}
            onChangeSource={(index, field, value) =>
              store.updateRecoverSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
            }
            onAddSource={() => store.addRecoverSource()}
            onRemoveSource={(index) => store.removeRecoverSource(index)}
            onNext={() =>
              void run(async () => {
                const recovered = await store.recoverKeyFromShares();
                onRecovered(recovered);
              })
            }
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function RecoverKeyView({
  recoveredKey,
  onClear,
}: {
  recoveredKey: { nsec: string; signingKeyHex: string } | null;
  onClear: () => void;
}) {
  if (!recoveredKey) return null;
  return <RecoverPrivateKeyView recovered={recoveredKey} onClear={onClear} />;
}
