# Video Editor

VS Code 비디오 편집기 개발 프로젝트입니다. 프로젝트 관리, 미디어 가져오기, 프레임 추출, 타임라인 편집 및 제한된 길이의 영상·오디오 미리보기를 지원합니다. 최종 영상 내보내기는 아직 제공하지 않습니다.

명령 팔레트에서 `Video Editor: Open`, `Video Editor: New Project`, `Video Editor: Open Project`, `Video Editor: Save Project`를 사용할 수 있습니다. 새 프로젝트는 1920×1080, 30fps, 48kHz로 생성됩니다. Edit 모드에서 미디어를 가져와 타임라인에 추가하고 클립을 이동·트림·분할·삭제할 수 있습니다. 오디오 클립을 선택해 클립·트랙 게인과 음소거, 클립 페이드를 조절하거나 연결된 오디오를 분리해 삭제할 수 있습니다. Source에서 원본 프레임을 탐색·PNG로 추출하고, Timeline에서 `Render timeline preview`를 실행하면 편집 결과를 재생할 수 있습니다. 미리보기는 전체 타임라인을 미리 렌더링하므로 시간이 걸리며 최대 30초, 1,800프레임, 200개 클립과 프레임·오디오 데이터 32 MiB로 제한됩니다. 화면은 최대 640×360으로 축소되며 손실 압축을 거칩니다. 입력은 현재 VP9 영상·Opus 및 일부 PCM 오디오로 제한됩니다.

코덱은 동봉하지 않습니다. `Check engine` 또는 `Video Editor: Check Media Engine`으로 별도 설치한 FFmpeg와 ffprobe의 기능을 검사할 수 있습니다. 설정 `videoEditor.ffmpegPath`와 `videoEditor.ffprobePath`에 절대 경로를 지정하거나 비워 두어 PATH를 사용합니다. [FFmpeg 공식 안내](https://ffmpeg.org/download.html)에서 설치 방법을 확인하고 해당 빌드의 라이선스와 코덱 특허 조건을 확인하세요.

개발 환경에서 `npm install` 후 `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`로 검증하고 `npm run package`로 시험용 VSIX를 생성·검사합니다. E2E는 격리된 `.vscode-test` 사용자 데이터와 확장 디렉터리를 사용하며 기본적으로 VS Code를 다운로드할 수 있습니다. 기존 실행 파일을 사용하려면 `VSCODE_EXECUTABLE_PATH`를 지정합니다. 통합 테스트에는 VP9·Opus가 활성화된 FFmpeg와 ffprobe가 필요합니다. Unix 계열에서 `python3 scripts/benchmark-engine.py`로 엔진 기준선을 측정할 수 있습니다. Linux에서 디스플레이 또는 headless 실행 환경이 필요합니다.

저장소의 설계와 진행 상황은 `docs/README.md`를 참고하세요 (VSIX에는 포함하지 않습니다). 프로젝트 라이선스는 아직 결정되지 않았습니다.
