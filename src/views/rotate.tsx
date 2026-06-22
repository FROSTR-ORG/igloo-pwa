import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CRITICAL_E2E_TEST_IDS,
  HostFlowShell,
  passwordManagerOptOutProps,
  ProfileConfirmationCard,
  Textarea,
} from 'igloo-ui';
import type { useStore } from '../lib/store';
import type { PwaProfile } from '../lib/types';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

export function RotateConnectView({
  store,
  run,
  selectedProfile,
  onBack,
}: {
  store: PwaStore;
  run: RunAction;
  selectedProfile: PwaProfile | null;
  onBack: () => void;
}) {
  if (!selectedProfile) return null;
  return (
    <HostFlowShell
      title="Rotate Key"
      description="Connect with a rotated onboarding package and prepare to replace the active device share."
      onBack={onBack}
      backTooltip="Back to dashboard"
    >
      <section className="igloo-flow-root igloo-stack">
        <ProfileConfirmationCard
          title="Current Device"
          profileName={selectedProfile.label}
          sharePublicKey={selectedProfile.share_public_key}
          groupPublicKey={selectedProfile.group_public_key}
          relays={selectedProfile.relays}
        />
        <Card>
          <CardHeader>
            <CardTitle>Connect Rotated bfonboard</CardTitle>
            <CardDescription>Use a rotated onboarding package to replace this device while keeping the same keyset identity.</CardDescription>
          </CardHeader>
          <CardContent className="igloo-stack">
            <label>
              bfonboard
              <Textarea
                className="min-h-[112px]"
                data-testid={CRITICAL_E2E_TEST_IDS.rotationPackageInput}
                value={store.drafts.rotateConnectForm.packageText}
                onChange={(event) => store.updateRotateConnectForm('packageText', event.target.value)}
                placeholder="Paste bfonboard1..."
              />
            </label>
            <label>
              Package Password
              <input
                type="password"
                {...passwordManagerOptOutProps}
                data-testid={CRITICAL_E2E_TEST_IDS.rotationPasswordInput}
                value={store.draftSecrets.rotateConnectFormPassword}
                onChange={(event) => store.updateRotateConnectPassword(event.target.value)}
              />
            </label>
            <div className="igloo-button-row">
              <Button
                type="button"
                size="sm"
                data-testid={CRITICAL_E2E_TEST_IDS.rotationConnectSubmit}
                onClick={() => void run(() => store.connectRotationPackage())}
              >
                Connect Rotation Package
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </HostFlowShell>
  );
}

export function RotateSaveView({
  store,
  run,
  selectedProfile,
}: {
  store: PwaStore;
  run: RunAction;
  selectedProfile: PwaProfile | null;
}) {
  if (!store.pendingRotationConnection || !selectedProfile) return null;
  return (
    <HostFlowShell
      title="Confirm Rotated Device"
      description="Review the replacement device details before replacing the active local profile."
      onBack={() => store.setActiveView('rotate-connect')}
      backTooltip="Back to connect"
    >
      <section className="igloo-flow-root igloo-stack">
        <ProfileConfirmationCard
          title="Replacement Preview"
          profileName={selectedProfile.label}
          sharePublicKey={store.pendingRotationConnection.preview.share_public_key}
          groupPublicKey={store.pendingRotationConnection.preview.group_public_key}
          relays={store.pendingRotationConnection.preview.relays}
        />
        <section className="igloo-task-banner">
          <span className="igloo-task-kicker">Same keyset, fresh device share</span>
          <p>This replacement keeps the same group public key and replaces this device with a new share and profile id.</p>
        </section>
        <label>
          Current Device Passphrase
          <input
            type="password"
            value={store.unlockPassphrase}
            onChange={(event) => store.setUnlockPassphrase(event.target.value)}
            placeholder="Enter the passphrase for the active device"
          />
        </label>
        <div className="igloo-button-row">
          <Button
            type="button"
            size="sm"
            data-testid={CRITICAL_E2E_TEST_IDS.rotationConfirmSubmit}
            onClick={() => void run(() => store.finalizeRotationUpdate())}
          >
            Replace Active Device
          </Button>
        </div>
      </section>
    </HostFlowShell>
  );
}
