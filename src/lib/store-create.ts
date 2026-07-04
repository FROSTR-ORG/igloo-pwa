import type { Dispatch, SetStateAction } from 'react';
import { saveBrowserProfileAndMaybeActivate } from 'igloo-shared';

import * as adapter from './local-adapter';
import type { SessionController } from './session-controller';
import { setDraftFormField, setDraftSecretField } from './store-drafts';
import { defaultDrafts } from './store-hydrate';
import type { PwaDraftState, PwaPersistedState, PwaProfile } from './types';

function readProfileGroupName(profile: PwaProfile | null) {
  if (!profile) return '';
  try {
    const parsed = JSON.parse(profile.group_package_json) as { group_name?: unknown };
    return typeof parsed.group_name === 'string' ? parsed.group_name.trim() : '';
  } catch {
    return '';
  }
}

function readUnlockedLocalSharePackageJson(
  profile: PwaProfile | null,
  snapshot: PwaPersistedState,
  controller: SessionController,
) {
  if (!profile) return null;
  const inState = snapshot.sharePackageJsonByProfileId[profile.id]?.trim();
  if (inState) return inState;
  const inSession = adapter.getSharePackageJsonForProfile(profile.id, controller)?.trim();
  return inSession || null;
}

function isKnownLocalSourcePackage(profile: PwaProfile | null, packageText: string) {
  const trimmed = packageText.trim();
  if (!profile || !trimmed) return false;
  return [
    profile.encrypted_bfshare_artifact,
    profile.share_string,
    profile.profile_string,
  ].some((candidate) => typeof candidate === 'string' && candidate.trim() === trimmed);
}

export type StoreCreateActions = {
  startCreateKeyset: () => void;
  updateCreateForm: (field: keyof PwaDraftState['createForm'] | 'privateKey', value: string) => void;
  updateRotationForm: (field: 'sourceProfileId', value: string) => void;
  updateRotationSource: (
    index: number,
    field: 'packageText' | 'password',
    value: string,
  ) => void;
  addRotationSource: () => void;
  removeRotationSource: (index: number) => void;
  setRotateDevicePassphrase: (value: string) => void;
  verifyRotateDeviceUnlock: () => Promise<void>;
  generateKeyset: () => Promise<void>;
  selectGeneratedShare: (memberIdx: number) => void;
  updateProfileForm: (field: keyof PwaDraftState['profileForm'], value: string) => void;
  updateProfileFormPassword: (field: 'password' | 'confirmPassword', value: string) => void;
  continueToSaveProfile: () => void;
  acceptGeneratedProfile: () => Promise<void>;
};

export function createCreateActions({
  controller,
  getState,
  setState,
}: {
  controller: SessionController;
  getState: () => PwaPersistedState;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
}): StoreCreateActions {
  return {
    startCreateKeyset() {
      controller.discardStagedSession();
      setState((current) => ({
        ...current,
        activeView: 'create-generate',
        drafts: {
          ...current.drafts,
          createForm: {
            ...current.drafts.createForm,
            mode: 'new',
          },
          rotationForm: {
            ...defaultDrafts.rotationForm,
            sources: defaultDrafts.rotationForm.sources.map((source) => ({ ...source })),
          },
        },
        draftSecrets: {
          ...current.draftSecrets,
          rotationSources: {},
          rotateDevicePassphrase: '',
          rotateDeviceUnlockVerified: false,
        },
      }));
    },
    updateCreateForm(field, value) {
      setState((current) => {
        if (field === 'privateKey') {
          // The raw nsec is a secret: it lives only in draftSecrets, never in
          // the persistable drafts partition.
          return setDraftSecretField(current, 'createFormPrivateKey', value);
        }
        return setDraftFormField(current, 'createForm', field, value);
      });
    },
    updateRotationForm(field, value) {
      setState((current) => setDraftFormField(current, 'rotationForm', field, value));
    },
    updateRotationSource(index, field, value) {
      setState((current) => {
        if (field === 'password') {
          return {
            ...current,
            draftSecrets: {
              ...current.draftSecrets,
              rotationSources: {
                ...current.draftSecrets.rotationSources,
                [index]: value,
              },
            },
          };
        }
        return {
          ...current,
          drafts: {
            ...current.drafts,
            rotationForm: {
              ...current.drafts.rotationForm,
              sources: current.drafts.rotationForm.sources.map((entry, sourceIndex) =>
                sourceIndex === index ? { ...entry, [field]: value } : entry,
              ),
            },
          },
        };
      });
    },
    addRotationSource() {
      setState((current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          rotationForm: {
            ...current.drafts.rotationForm,
            sources: [...current.drafts.rotationForm.sources, { packageText: '' }],
          },
        },
      }));
    },
    removeRotationSource(index) {
      setState((current) => {
        const nextRotationSecrets = { ...current.draftSecrets.rotationSources };
        delete nextRotationSecrets[index];
        return {
          ...current,
          drafts: {
            ...current.drafts,
            rotationForm: {
              ...current.drafts.rotationForm,
              sources:
                current.drafts.rotationForm.sources.length > 1
                  ? current.drafts.rotationForm.sources.filter((_, sourceIndex) => sourceIndex !== index)
                  : current.drafts.rotationForm.sources,
            },
          },
          draftSecrets: {
            ...current.draftSecrets,
            rotationSources: nextRotationSecrets,
          },
        };
      });
    },
    setRotateDevicePassphrase(value) {
      setState((current) => ({
        ...current,
        draftSecrets: {
          ...current.draftSecrets,
          rotateDevicePassphrase: value,
          // A changed passphrase must be re-verified before it counts again.
          rotateDeviceUnlockVerified: false,
        },
      }));
    },
    async verifyRotateDeviceUnlock() {
      const snapshot = getState();
      const sourceProfile = snapshot.profiles.find(
        (profile) => profile.id === snapshot.drafts.rotationForm.sourceProfileId,
      );
      if (!sourceProfile) {
        return;
      }
      const verified = await adapter.verifyDeviceShareUnlock({
        encryptedShareArtifact: sourceProfile.encrypted_bfshare_artifact,
        devicePassphrase: snapshot.draftSecrets.rotateDevicePassphrase,
      });
      setState((current) => ({
        ...current,
        draftSecrets: { ...current.draftSecrets, rotateDeviceUnlockVerified: verified },
      }));
    },
    async generateKeyset() {
      const snapshot = getState();
      const threshold = Number.parseInt(snapshot.drafts.createForm.threshold, 10);
      const count = Number.parseInt(snapshot.drafts.createForm.count, 10);
      const sourceProfile =
        snapshot.drafts.createForm.mode === 'rotate'
          ? snapshot.profiles.find((profile) => profile.id === snapshot.drafts.rotationForm.sourceProfileId) ?? null
          : null;
      const rotationGroupName =
        snapshot.drafts.createForm.groupName.trim()
        || readProfileGroupName(sourceProfile)
        || sourceProfile?.label
        || '';
      if (snapshot.drafts.createForm.mode === 'rotate' && !sourceProfile) {
        throw new Error('Select the device profile to rotate.');
      }
      const unlockedLocalSharePackageJson = readUnlockedLocalSharePackageJson(
        sourceProfile,
        snapshot,
        controller,
      );
      const localSource =
        sourceProfile && unlockedLocalSharePackageJson
          ? { profile: sourceProfile, sharePackageJson: unlockedLocalSharePackageJson }
          : null;
      const keyset =
        snapshot.drafts.createForm.mode === 'rotate' && sourceProfile
          ? await adapter.createRotatedKeyset({
              groupPackageJson: sourceProfile.group_package_json,
              groupName: rotationGroupName,
              threshold,
              count,
              // Auto-include the rotating device's own current share so the
              // operator only pastes the other members' bfshares.
              encryptedShareArtifact: sourceProfile.encrypted_bfshare_artifact,
              devicePassphrase: snapshot.draftSecrets.rotateDevicePassphrase,
              localSource,
              sources: snapshot.drafts.rotationForm.sources
                .map((source, index) => ({
                  packageText: source.packageText.trim(),
                  password: snapshot.draftSecrets.rotationSources[index] ?? '',
                }))
                .filter(
                  (source) =>
                    source.packageText &&
                    source.password &&
                    !(localSource && isKnownLocalSourcePackage(sourceProfile, source.packageText)),
                ),
            })
          : await adapter.createGeneratedKeyset({
              groupName: snapshot.drafts.createForm.groupName,
              threshold,
              count,
              privateKey: snapshot.draftSecrets.createFormPrivateKey,
            });
      // D.1/PR16b: `share_package_json` no longer lives on persisted
      // profiles. Use the public `member_idx` field to pick the
      // matching slot in the rotated keyset.
      const preferredMemberIdx =
        sourceProfile && typeof sourceProfile.member_idx === 'number' && sourceProfile.member_idx > 0
          ? sourceProfile.member_idx
          : NaN;
      const selectedShare =
        keyset.shares.find((share) => share.member_idx === preferredMemberIdx) ?? keyset.shares[0];
      setState((current) => ({
        ...current,
        pendingKeyset: keyset,
        selectedGeneratedShareIdx: selectedShare?.member_idx ?? null,
        activeView: 'create-select-share',
        drafts: {
          ...current.drafts,
          profileForm: {
            ...current.drafts.profileForm,
            label: sourceProfile?.label ?? selectedShare?.name ?? `${keyset.group_name} Device`,
            relayUrls: sourceProfile?.relays?.join('\n') ?? current.drafts.profileForm.relayUrls,
          },
        },
        // The rotate device passphrase has served its purpose; do not retain it.
        draftSecrets: {
          ...current.draftSecrets,
          rotateDevicePassphrase: '',
          rotateDeviceUnlockVerified: false,
        },
      }));
    },
    selectGeneratedShare(memberIdx) {
      setState((current) => ({
        ...current,
        selectedGeneratedShareIdx: memberIdx,
        drafts: {
          ...current.drafts,
          profileForm: {
            ...current.drafts.profileForm,
            label:
              current.pendingKeyset?.shares.find((share) => share.member_idx === memberIdx)?.name ??
              current.drafts.profileForm.label,
          },
        },
      }));
    },
    updateProfileForm(field, value) {
      setState((current) => setDraftFormField(current, 'profileForm', field, value));
    },
    continueToSaveProfile() {
      const snapshot = getState();
      if (!snapshot.pendingKeyset || snapshot.selectedGeneratedShareIdx == null) {
        throw new Error('Generate a keyset and choose one share first.');
      }
      setState((current) => ({ ...current, activeView: 'create-save-profile' }));
    },
    updateProfileFormPassword(field, value) {
      setState((current) =>
        setDraftSecretField(
          current,
          field === 'password' ? 'profileFormPassword' : 'profileFormConfirm',
          value,
        ),
      );
    },
    async acceptGeneratedProfile() {
      const snapshot = getState();
      if (!snapshot.pendingKeyset || snapshot.selectedGeneratedShareIdx == null) {
        throw new Error('Generate a keyset and choose one share first.');
      }
      if (!snapshot.drafts.profileForm.label.trim()) {
        throw new Error('Device profile name is required.');
      }
      if (!snapshot.draftSecrets.profileFormPassword) {
        throw new Error('Device password is required.');
      }
      if (snapshot.draftSecrets.profileFormPassword !== snapshot.draftSecrets.profileFormConfirm) {
        throw new Error('Device password confirmation does not match.');
      }
      if (!snapshot.drafts.profileForm.relayUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).length) {
        throw new Error('At least one relay is required.');
      }

      const password = snapshot.draftSecrets.profileFormPassword;
      const profile = await adapter.createDeviceProfileFromGeneratedShare({
        keyset: snapshot.pendingKeyset,
        shareMemberIdx: snapshot.selectedGeneratedShareIdx,
        label: snapshot.drafts.profileForm.label,
        password,
        relayUrls: snapshot.drafts.profileForm.relayUrls,
        existingProfileIds: snapshot.profiles.map((entry) => entry.id),
      });
      const saved = await saveBrowserProfileAndMaybeActivate({
        profile,
        autoStart: true,
        activate: async () => await adapter.startSession(profile, password, controller),
      });
      const runtimeSnapshot = saved.runtime;
      const remaining = snapshot.pendingKeyset.shares
        .map((share) => share.member_idx)
        .filter((memberIdx) => memberIdx !== snapshot.selectedGeneratedShareIdx);

      setState((current) => ({
        ...current,
        profiles: [profile, ...current.profiles.filter((entry) => entry.id !== profile.id)],
        selectedProfileId: profile.id,
        activeView: 'create-distribute',
        activeDashboardTab: 'signer',
        unlockPassphrase: password,
        runtimeSnapshot,
        runtimeWarning: saved.runtimeWarning?.message ?? null,
        peerPermissionStates:
          runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        distributionSession: {
          profile_id: profile.id,
          signer_pubkey: runtimeSnapshot?.runtime_host?.signer_pubkey ?? profile.share_public_key,
          remaining_member_indices: remaining,
          results: {},
          qr_package: null,
        },
        drafts: {
          ...current.drafts,
          distributionForms: Object.fromEntries(
            remaining.map((memberIdx) => {
              const share = snapshot.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
              return [
                memberIdx,
                {
                  label: share?.name ?? `Member ${memberIdx}`,
                },
              ];
            }),
          ),
          distributionPermissions: Object.fromEntries(
            remaining.map((memberIdx) => [memberIdx, ['sign', 'ecdh', 'ping', 'onboard']]),
          ),
        },
        draftSecrets: {
          ...current.draftSecrets,
          distributionPasswords: {},
          profileFormPassword: '',
          profileFormConfirm: '',
        },
      }));
    },
  };
}
