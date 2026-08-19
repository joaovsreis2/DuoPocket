# DuoPocket

Aplicativo local para organizar e iniciar backups próprios de jogos de Game
Boy, Game Boy Color, Game Boy Advance e Nintendo DS no Windows.

## Recursos

- Biblioteca pesquisável com importação de arquivos ou pastas inteiras.
- Detecção automática de título e sistema pelo cabeçalho da ROM.
- Favoritos, recentes, contagem de sessões e reabertura da pasta do jogo.
- DuoGBA próprio (alpha) para `.gba`, com CPU ARM7TDMI, barramento e vídeo básico.
- melonDS 1.1 para `.nds`, incluindo tela de toque pelo mouse (núcleo próprio DS
  será a próxima etapa).
- Atalhos, saves, save states e gamepads fornecidos pelos emuladores nativos.
- Instalador e versão portátil `.zip` para Windows x64, ambos totalmente offline.

### Estado do núcleo próprio

O DuoGBA é uma implementação própria em JavaScript e já possui CPU ARM7TDMI
(ARM/Thumb), barramento de memória, vídeo bitmap/tile básico e controles. A
ROM ARM mínima de teste executa instruções e escreve no VRAM. Esta é uma fase
alpha: compatibilidade completa com jogos comerciais, áudio, DMA, timers,
interrupções e Game Boy/Game Boy Color ainda serão adicionados antes de chamar
o núcleo de estável.

## Uso

1. Instale o DuoPocket pelo arquivo `DuoPocket Setup 1.0.0.exe`; ou extraia a
   versão portátil `.zip` e abra `DuoPocket.exe`.
2. Clique em **Adicionar jogos** e escolha arquivos, ou use a seta ao lado para
   importar uma pasta.
3. Selecione um jogo e clique em **Jogar agora**.
4. Configure controles, vídeo e áudio diretamente em **Ajustar emulador**.

Os saves pertencem aos emuladores. Por padrão, o mGBA cria o save de bateria ao
lado da ROM. O melonDS mantém suas configurações e saves conforme a configuração
do próprio emulador. Não mova uma ROM e seu arquivo de save separadamente.

## Nintendo DS e BIOS

O melonDS inicia a maioria dos jogos por direct boot sem BIOS externa. Recursos
de firmware/boot completo e alguns casos específicos podem exigir arquivos
extraídos do próprio Nintendo DS. Abra **Ajustar emulador** no DuoPocket e
configure seus arquivos em `Config > Emu settings`. O projeto não fornece BIOS,
firmware, chaves ou ROMs.

## Desenvolvimento

Requisitos: Windows 10/11 x64, Node.js 24+ e npm.

```powershell
npm install
npm start
```

Para testar e gerar instalador + versão portátil:

```powershell
npm run dist
```

Os artefatos são gravados em `dist/`.

## Aviso do Windows

Esta compilação interna não possui certificado comercial de assinatura de
código. Por isso, o Microsoft Defender SmartScreen pode exibir **O Windows
protegeu o computador** na primeira abertura. Confira o SHA-256 em
`dist/SHA256SUMS.txt` e, se ele corresponder, use **Mais informações > Executar
assim mesmo**. Esse aviso não aparece por causa dos emuladores; ele é esperado
para qualquer executável interno sem certificado público.

## Atalhos do launcher

- `Ctrl+O`: adicionar arquivos.
- `Ctrl+Shift+O`: importar uma pasta.
- `Ctrl+F`: pesquisar na biblioteca.
- `Enter`: iniciar o jogo selecionado.

Consulte também [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
