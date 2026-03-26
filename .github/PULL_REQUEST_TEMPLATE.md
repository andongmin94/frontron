## Summary

- explain the user-facing or maintainer-facing change

## Validation

- [ ] `cd docs && npm run validate`
- [ ] `cd packages/frontron && npm run build`
- [ ] `cd packages/frontron && npm run typecheck`
- [ ] `cd packages/frontron && npm test`
- [ ] `cd packages/create-frontron && npm run build`
- [ ] `cd packages/create-frontron && npm run typecheck`
- [ ] `cd packages/create-frontron && npm test`

## Contract checks

- [ ] English and Korean mirrored docs were kept aligned for user-facing changes
- [ ] No deleted `specs/` or removed root-doc references were reintroduced
- [ ] The change keeps `frontron/client`, root `frontron.config.ts`, and framework-owned runtime/build responsibilities intact
