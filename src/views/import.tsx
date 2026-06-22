import {
  Button,
  CreateFlowProfileSetup,
  ImportProfileEntry,
  PageBackLink,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  StepProgress,
  WarningCard,
} from 'igloo-ui';
import { pingRelay } from 'igloo-shared';
import type { useStore } from '../lib/store';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

const IMPORT_FLOW_STEPS = ['Import Profile', 'Save Profile'];

export function LoadImportView({
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
        <StepProgress steps={IMPORT_FLOW_STEPS} active={0} />
        <PageBackLink label="Back to Welcome" onBack={onBack} />
        <PublicTaskTitle
          title="Import Device Profile"
          description="Import an existing signing device using an encrypted backup."
        />
        <section className="igloo-flow-root">
          <ImportProfileEntry
            profileString={store.drafts.importProfileForm.profileString}
            password={store.draftSecrets.importProfileFormPassword}
            onProfileStringChange={(value) => store.updateImportProfileForm('profileString', value)}
            onPasswordChange={(value) => store.updateImportProfilePassword(value)}
            onNext={() => void run(() => store.loadBfProfile())}
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function LoadErrorView({ store, onBack }: { store: PwaStore; onBack: () => void }) {
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={IMPORT_FLOW_STEPS} active={0} />
        <PageBackLink label="Back to Welcome" onBack={onBack} />
        <PublicTaskTitle
          title="Import Error"
          description="We couldn't import this profile backup. Resolve the issue below and try again."
        />
        <section className="igloo-flow-root">
          <div className="igloo-onboard-form">
            <WarningCard
              title="Import Failed"
              message={store.pendingLoadError ?? 'We couldn’t import this profile backup.'}
            />
            <div className="igloo-onboard-action-row">
              <Button type="button" onClick={() => store.clearLoadError()}>
                Try Again
              </Button>
              <Button type="button" variant="secondary" onClick={onBack}>
                Back to Welcome
              </Button>
            </div>
          </div>
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function LoadConfirmView({ store, run }: { store: PwaStore; run: RunAction }) {
  if (!store.pendingLoadConfirmation) return null;
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={IMPORT_FLOW_STEPS} active={1} />
        <PageBackLink label="Back" onBack={() => store.setActiveView('load-import')} />
        <PublicTaskTitle
          title="Save Profile"
          description="Name this local profile, protect it with a password, and choose the relays it should use."
        />
        <section className="igloo-flow-root">
          <CreateFlowProfileSetup
            draft={{
              label: store.drafts.importSaveForm.label,
              relayUrls: store.drafts.importSaveForm.relayUrls,
              primarySecret: store.draftSecrets.importSaveFormPassword,
              secondarySecret: store.draftSecrets.importSaveFormConfirm,
            }}
            lockIdentity
            actionLabel="Launch Signer"
            onLabelChange={(value) => store.updateImportSaveForm('label', value)}
            onPrimarySecretChange={(value) => store.updateImportSavePassword('password', value)}
            onSecondarySecretChange={(value) => store.updateImportSavePassword('confirmPassword', value)}
            onPingRelay={(url) => pingRelay(url)}
            onAction={() => void run(() => store.acceptPendingLoadConfirmation())}
          />
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}
