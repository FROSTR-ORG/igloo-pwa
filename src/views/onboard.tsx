import {
  CreateFlowProfileSetup,
  OnboardFailedPanel,
  OnboardHandshakePanel,
  OnboardPackageEntry,
  PageBackLink,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  StepProgress,
} from 'igloo-ui';
import { pingRelay } from 'igloo-shared';
import type { useStore } from '../lib/store';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

const ONBOARD_FLOW_STEPS = ['Input Package', 'Onboard Device', 'Save Profile'];

export function OnboardConnectView({
  store,
  run,
  onBack,
}: {
  store: PwaStore;
  run: RunAction;
  onBack: () => void;
}) {
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={ONBOARD_FLOW_STEPS} active={0} />
        <PageBackLink label="Back to Welcome" onBack={onBack} />
        <PublicTaskTitle
          title="Input Package"
          description="Create a new signing device from an onboarding package."
        />
        <section className="igloo-flow-root">
          <OnboardPackageEntry
            packageText={store.drafts.onboardConnectForm.packageText}
            password={store.draftSecrets.onboardConnectFormPassword}
            onPackageTextChange={(value) => store.updateOnboardConnectForm('packageText', value)}
            onPasswordChange={(value) => store.updateOnboardConnectPassword(value)}
            onConnect={() => void run(() => store.connectOnboardingPackage())}
            actionLabel="Next Step"
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function OnboardHandshakeView({ store }: { store: PwaStore }) {
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={ONBOARD_FLOW_STEPS} active={1} />
        <section className="igloo-flow-root">
          <OnboardHandshakePanel
            title="Onboard Device"
            packageText={store.drafts.onboardConnectForm.packageText}
            keysetName="My Signing Key"
            thresholdLabel="2/3"
            activeStep="negotiate"
            onCancel={() => store.setActiveView('onboard-connect')}
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function OnboardFailedView({
  store,
  onRetry,
}: {
  store: PwaStore;
  onRetry: () => void;
}) {
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={ONBOARD_FLOW_STEPS} active={1} />
        <PublicTaskTitle
          title="Onboarding Failed"
          description="We couldn't finish onboarding this device. Review the details below and retry."
        />
        <section className="igloo-flow-root">
          <OnboardFailedPanel
            keysetName="My Signing Key"
            thresholdLabel="2/3"
            activeStep="negotiate"
            onRetry={onRetry}
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function OnboardSaveView({ store, run }: { store: PwaStore; run: RunAction }) {
  if (!store.pendingOnboardConnection) return null;
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={ONBOARD_FLOW_STEPS} active={2} />
        <PageBackLink label="Cancel" onBack={() => store.cancelOnboarding()} />
        <PublicTaskTitle
          title="Save Profile"
          description="Name and protect this profile on the device before launching the signer."
        />
        <section className="igloo-flow-root">
          <CreateFlowProfileSetup
            draft={{
              label: store.drafts.onboardSaveForm.label,
              relayUrls: store.drafts.onboardSaveForm.relayUrls,
              primarySecret: store.draftSecrets.onboardSaveFormPassword,
              secondarySecret: store.draftSecrets.onboardSaveFormConfirm,
            }}
            lockIdentity
            lockName={false}
            actionLabel="Launch Signer"
            onLabelChange={(value) => store.updateOnboardSaveForm('label', value)}
            onPrimarySecretChange={(value) => store.updateOnboardSavePassword('password', value)}
            onSecondarySecretChange={(value) => store.updateOnboardSavePassword('confirmPassword', value)}
            onPingRelay={(url) => pingRelay(url)}
            onAction={() => void run(() => store.finalizeOnboardedDevice())}
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}
