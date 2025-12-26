# Versionamento e atualizacoes

Este projeto segue Semantic Versioning e Keep a Changelog.

## Antes de commit e push

1. Atualize `CHANGELOG.md` na secao `[Unreleased]`.
2. Se for release:
   - Crie a nova secao `## [vX.Y.Z] - YYYY-MM-DD`.
   - Mova os itens de `[Unreleased]` para a nova secao.
   - Atualize os links no final do `CHANGELOG.md`.
3. (Opcional) Crie `RELEASE_NOTES_vX.Y.Z.md` quando necessario.

## Publicar versao

```bash
git tag vX.Y.Z
git push origin main --tags
```

## Observacoes

- O arquivo `VERSION` e atualizado automaticamente nos ambientes remotos pelo `update.sh` apos o pull.
- Use o botao "Update" na aba Manutencao para aplicar mudancas nos ambientes remotos.
