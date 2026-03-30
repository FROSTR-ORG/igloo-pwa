# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [Unreleased]

### Changed
- The browser host now shares more of its host-shell, review, and distribution flow framing with `igloo-home` through `igloo-ui`.
- The create and rotation distribution steps now use the shared share-label and package-password distribution contract.

### Fixed
- PWA end-to-end flows now match the shared create-flow surface and rotation timing expectations after the host-shell hard cut.
- The PWA Playwright web server now launches without the transient `NO_COLOR` and `FORCE_COLOR` warning.

## [0.2.0] - 2026-03-27

### Added
- Root project documentation for usage, testing, and contribution flow.

### Changed
- Profile import, recovery, onboarding, and rotation flows now consume structured `groupPackage` with embedded `groupName`.
- New-group creation now asks for a group name explicitly and uses it consistently in generated group/share labeling.
- Persisted profile handling no longer treats remote peer policy observations as durable profile state.

### Fixed
- Browser-side rotation creation now preserves embedded group metadata through raw group JSON helpers.
- App and fixture surfaces now match the current package schema and error formatting model.
