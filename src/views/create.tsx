import {
  Button,
  CreateFlowDistributionSection,
  CreateFlowGenerateCard,
  CreateFlowProfileSetup,
  CreateFlowShareSelection,
  CRITICAL_E2E_TEST_IDS,
  OnboardingClientCard,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  QrPayloadModal,
  RotateKeysetPanel,
  StepProgress,
  type SharedDistributionResult,
} from 'igloo-ui';
import { pingRelay, shortProfileId } from 'igloo-shared';
import type { useStore } from '../lib/store';
import type { PwaProfile } from '../lib/types';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

const CREATE_FLOW_STEPS = ['Create Keyset', 'Select Share', 'Save Profile', 'Distribute Shares'];

export function CreateGenerateView({
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
        <StepProgress steps={CREATE_FLOW_STEPS} active={0} />
        <PublicTaskTitle
          title="Create Keyset"
          description="Define the group profile for a new keyset. After generation, choose which share stays on this device, then distribute the rest."
        />
        {store.drafts.createForm.mode === 'new' ? (
          <CreateFlowGenerateCard
            groupName={store.drafts.createForm.groupName}
            threshold={store.drafts.createForm.threshold}
            count={store.drafts.createForm.count}
            privateKey={store.draftSecrets.createFormPrivateKey}
            onChangeForm={(field, value) => store.updateCreateForm(field, value)}
            onGenerate={() => void run(() => store.generateKeyset())}
            onBack={onBack}
          />
        ) : null}
        {store.profiles.length > 0 ? (
          <div className="igloo-button-row igloo-button-row-tight" role="group" aria-label="Keyset action mode">
            <Button
              type="button"
              size="sm"
              variant={store.drafts.createForm.mode === 'new' ? 'default' : 'secondary'}
              data-testid={CRITICAL_E2E_TEST_IDS.createModeNew}
              onClick={() => store.updateCreateForm('mode', 'new')}
            >
              New Keyset
            </Button>
            <Button
              type="button"
              size="sm"
              variant={store.drafts.createForm.mode === 'rotate' ? 'default' : 'secondary'}
              data-testid={CRITICAL_E2E_TEST_IDS.createModeRotate}
              onClick={() => store.updateCreateForm('mode', 'rotate')}
            >
              Rotate Existing
            </Button>
          </div>
        ) : null}
        {store.drafts.createForm.mode === 'rotate' ? (
          <RotateKeysetPanel
            sourceProfileId={store.drafts.rotationForm.sourceProfileId}
            availableProfiles={store.profiles.map((profile) => ({
              id: profile.id,
              label: `${profile.label || 'Unnamed device'} (${shortProfileId(profile.id)})`,
            }))}
            devicePassphrase={store.draftSecrets.rotateDevicePassphrase}
            onChangeDevicePassphrase={(value) => store.setRotateDevicePassphrase(value)}
            deviceShareValidated={store.draftSecrets.rotateDeviceUnlockVerified}
            onVerifyDevicePassphrase={() => void store.verifyRotateDeviceUnlock()}
            rotationSources={store.drafts.rotationForm.sources.map((source, index) => ({
              packageText: source.packageText,
              packagePassword: store.draftSecrets.rotationSources[index] ?? '',
            }))}
            onChangeSourceProfile={(profileId) => store.updateRotationForm('sourceProfileId', profileId)}
            onChangeRotationSource={(index, field, value) =>
              store.updateRotationSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
            }
            onAddRotationSource={() => store.addRotationSource()}
            onRemoveRotationSource={(index) => store.removeRotationSource(index)}
            onRotate={() => void run(() => store.generateKeyset())}
          />
        ) : null}
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function CreateSelectShareView({ store, run }: { store: PwaStore; run: RunAction }) {
  if (!store.pendingKeyset) return null;
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={CREATE_FLOW_STEPS} active={1} />
        <PublicTaskTitle
          title="Select Share"
          description="Choose which share stays on this device. The group public key identifies the shared signer for every device."
        />
        <CreateFlowShareSelection
          shares={store.pendingKeyset.shares}
          selectedMemberIdx={store.selectedGeneratedShareIdx}
          keysetName={store.pendingKeyset.group_name}
          groupPublicKey={store.pendingKeyset.group_public_key}
          onSelectShare={(memberIdx) => store.selectGeneratedShare(memberIdx)}
          onCopyGroupPublicKey={() => {
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(store.pendingKeyset?.group_public_key ?? '');
            }
          }}
          onAction={() => void run(() => store.continueToSaveProfile())}
          onBack={() => store.setActiveView('create-generate')}
        />
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function CreateSaveProfileView({ store, run }: { store: PwaStore; run: RunAction }) {
  if (!store.pendingKeyset) return null;
  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={CREATE_FLOW_STEPS} active={2} />
        <PublicTaskTitle
          title="Save Profile"
          description="Name and protect the local profile before remote shares are packaged for distribution."
        />
        <CreateFlowProfileSetup
          draft={{
            label: store.drafts.profileForm.label,
            relayUrls: store.drafts.profileForm.relayUrls,
            primarySecret: store.draftSecrets.profileFormPassword,
            secondarySecret: store.draftSecrets.profileFormConfirm,
          }}
          actionLabel="Next Step"
          onLabelChange={(value) => store.updateProfileForm('label', value)}
          onPrimarySecretChange={(value) => store.updateProfileFormPassword('password', value)}
          onSecondarySecretChange={(value) => store.updateProfileFormPassword('confirmPassword', value)}
          onRelaysChange={(relays) => store.updateProfileForm('relayUrls', relays.join('\n'))}
          onPingRelay={(url) => pingRelay(url)}
          onAction={() => void run(() => store.acceptGeneratedProfile())}
          onBack={() => store.setActiveView('create-select-share')}
        />
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}

export function CreateDistributeView({
  store,
  run,
  selectedProfile,
}: {
  store: PwaStore;
  run: RunAction;
  selectedProfile: PwaProfile | null;
}) {
  if (!store.pendingKeyset || !store.distributionSession || !selectedProfile) return null;
  const session = store.distributionSession;
  const remainingShares = store.pendingKeyset.shares.filter((share) =>
    session.remaining_member_indices.includes(share.member_idx),
  );
  const distributionResults = Object.fromEntries(
    Object.entries(session.results).map(([memberIdx, result]) => [
      Number(memberIdx),
      {
        status: result.status,
        label: result.label,
        packageText: result.package_text,
      },
    ]),
  ) as Record<number, SharedDistributionResult>;

  const handleFinishSetup = () => {
    const undelivered = session.remaining_member_indices.filter((idx) => {
      const status = session.results[idx]?.status ?? 'draft';
      return status === 'draft' || status === 'packaged';
    });
    if (undelivered.length > 0) {
      const confirmed = window.confirm(
        `${undelivered.length} ${undelivered.length === 1 ? 'share is' : 'shares are'} not yet delivered. Finish setup anyway?`,
      );
      if (!confirmed) return;
    }
    void run(() => store.finishSetup());
  };

  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={CREATE_FLOW_STEPS} active={3} />
        <PublicTaskTitle
          title="Distribute Shares"
          description="Create each remote onboarding package, set its peer permissions, and mark it delivered when the package has been handed off."
        />
        <CreateFlowDistributionSection
          sectionTitle="Remote Shares"
          sectionDescription="Each share can be copied, saved, shown as a QR package, or marked delivered after handoff."
          beforeCards={
            <OnboardingClientCard
              running={Boolean(store.runtimeSnapshot?.active)}
              relayCount={selectedProfile.relays.length}
              peerCount={store.peerPermissionStates.length}
              signerPubkey={session.signer_pubkey}
              onStart={() => void run(() => store.startDistributionClient())}
              onStop={() => void run(() => store.stopDistributionClient())}
            />
          }
          shares={remainingShares}
          drafts={Object.fromEntries(
            Object.entries(store.drafts.distributionForms).map(([memberIdx, form]) => {
              const idx = Number(memberIdx);
              const passwordSlot = store.draftSecrets.distributionPasswords[idx] ?? {
                password: '',
                confirmPassword: '',
              };
              return [
                idx,
                {
                  label: form.label,
                  packagePassword: passwordSlot.password,
                  confirmPassword: passwordSlot.confirmPassword,
                },
              ];
            }),
          )}
          results={distributionResults}
          permissions={store.drafts.distributionPermissions}
          onTogglePermission={(memberIdx, permission, enabled) =>
            void run(() => store.updateDistributionPermission(memberIdx, permission, enabled))
          }
          onChangeDraft={(memberIdx, field, value) => {
            if (field === 'packagePassword') {
              store.updateDistributionPassword(memberIdx, 'password', value);
            } else if (field === 'confirmPassword') {
              store.updateDistributionPassword(memberIdx, 'confirmPassword', value);
            } else {
              store.updateDistributionForm(memberIdx, 'label', value);
            }
          }}
          onDistribute={(memberIdx, kind) => void run(() => store.distributeShare(memberIdx, kind))}
          onFinish={handleFinishSetup}
          onBack={() => store.setActiveView('create-save-profile')}
        />
        <QrPayloadModal
          open={Boolean(session.qr_package)}
          onClose={() => store.closeQrPackage()}
          title="Onboarding Package QR"
          label={session.qr_package?.label}
          payload={session.qr_package?.package_text ?? ''}
        />
      </PublicTaskShell>
      <PublicFocusFooter />
    </>
  );
}
