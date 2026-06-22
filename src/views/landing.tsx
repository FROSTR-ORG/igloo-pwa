import {
  CRITICAL_E2E_TEST_IDS,
  PublicFocusFooter,
  WelcomeEntryHero,
  WelcomeReturningHero,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';

export function LandingView({
  profiles,
  layout,
  onGenerate,
  onImport,
  onOnboard,
  onUnlock,
  onRotate,
  onRecover,
  onDelete,
}: {
  profiles: WelcomeReturningProfileModel[];
  layout: 'single' | 'multi' | 'many';
  onGenerate: () => void;
  onImport: () => void;
  onOnboard: () => void;
  onUnlock: (profileId: string) => void;
  onRotate: (profileId: string) => void;
  onRecover: (profileId: string) => void;
  onDelete: (profileId: string) => void;
}) {
  if (profiles.length === 0) {
    return (
      <WelcomeEntryHero
        logoSrc="/igloo-paper-mark.png"
        productLabel="Igloo Web"
        tagline="Split your Nostr key. Sign from anywhere."
        primaryAction={{
          heading: 'Generate New Keyset',
          description: 'Generate a new threshold keyset and set up its first device profile.',
          buttonLabel: 'Generate Keyset',
          onAction: onGenerate,
          testId: CRITICAL_E2E_TEST_IDS.welcomeEntryGenerate,
        }}
        secondaryActions={[
          { id: 'import', label: 'Import Existing Device', onAction: onImport, testId: CRITICAL_E2E_TEST_IDS.welcomeEntryImport },
          { id: 'onboard', label: 'Onboard New Device', onAction: onOnboard, testId: CRITICAL_E2E_TEST_IDS.welcomeEntryOnboard },
        ]}
        footer={<PublicFocusFooter />}
      />
    );
  }

  return (
    <WelcomeReturningHero
      logoSrc="/igloo-paper-mark.png"
      productLabel="Igloo Web"
      layout={layout}
      profiles={profiles}
      onUnlock={onUnlock}
      onRotate={onRotate}
      onRecover={onRecover}
      onDelete={onDelete}
      secondaryActions={[
        { id: 'generate', label: 'Generate Keyset', onAction: onGenerate, testId: CRITICAL_E2E_TEST_IDS.welcomeEntryGenerate },
        { id: 'import', label: 'Import Existing Device', onAction: onImport, testId: CRITICAL_E2E_TEST_IDS.welcomeEntryImport },
        { id: 'onboard', label: 'Onboard New Device', onAction: onOnboard, testId: CRITICAL_E2E_TEST_IDS.welcomeEntryOnboard },
      ]}
      footer={<PublicFocusFooter />}
    />
  );
}
