# Video Editor

VS Code 비디오 편집기 개발 프로젝트입니다. 현재 Preview·Edit 화면 전환, 프로젝트 생성·열기·저장, 미디어 가져오기와 원본 프레임 탐색·PNG 추출을 지원합니다. 영상 재생·타임라인 편집 UI 및 내보내기는 아직 제공하지 않습니다.

명령 팔레트에서 `Video Editor: Open`, `Video Editor: New Project`, `Video Editor: Open Project`, `Video Editor: Save Project`를 사용할 수 있습니다. 새 프로젝트는 임시 기본값 1920×1080, 30fps, 48kHz로 생성됩니다. 누락되거나 변경된 원본은 편집기 Project media 목록의 Relink로 선택·확인 후 다시 연결할 수 있습니다. Edit 모드에서 Import media를 사용하고 목록의 Preview로 영상을 선택하면 이전·다음 프레임, 프레임 번호 또는 경과 시간으로 탐색하고 PNG로 저장할 수 있습니다. 프로젝트 미디어 목록에는 영상 썸네일과 오디오 파형이 생성되며 디스크 캐시를 사용합니다. 프레임 탐색은 키프레임 인덱스를 사용하며 인덱싱·디코딩 중 진행 상태와 취소를 제공합니다. 입력은 현재 VP9 영상·Opus 오디오와 일부 PCM 오디오로 제한됩니다. Edit 모드에서 미디어를 타임라인에 추가하고 클립을 선택해 프레임 번호로 이동·트림·분할·삭제·리플 삭제하거나 드래그로 이동할 수 있습니다. undo/redo, 확대·축소와 스냅도 제공합니다. 타임라인 영상 재생·미리보기와 오디오 믹싱은 아직 구현되지 않았습니다. 코덱은 동봉하지 않습니다. `Check engine` 또는 `Video Editor: Check Media Engine`으로 별도 설치한 FFmpeg와 ffprobe의 기능을 검사할 수 있습니다. 설정 `videoEditor.ffmpegPath`와 `videoEditor.ffprobePath`에 절대 경로를 지정하거나 비워 두어 PATH를 사용합니다. [FFmpeg 공식 안내](https://ffmpeg.org/download.html)에서 설치 방법을 확인하고 해당 빌드의 라이선스와 코덱 특허 조건을 확인하세요. 이 검사는 기능 목록 확인이며 미디어 편집 기능은 아직 없습니다.

개발 환경에서 `npm install` 후 `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`로 검증하고 `npm run package`로 시험용 VSIX를 생성·검사합니다. E2E는 격리된 `.vscode-test` 사용자 데이터와 확장 디렉터리를 사용하며 기본적으로 VS Code를 다운로드할 수 있습니다. 기존 실행 파일을 사용하려면 `VSCODE_EXECUTABLE_PATH`를 지정합니다. 통합 테스트에는 VP9·Opus가 활성화된 FFmpeg와 ffprobe가 필요합니다. Unix 계열에서 `python3 scripts/benchmark-engine.py`로 엔진 기준선을 측정할 수 있습니다. Linux에서 디스플레이 또는 headless 실행 환경이 필요합니다.

저장소의 설계와 진행 상황은 `docs/README.md`를 참고하세요 (VSIX에는 포함하지 않습니다). 프로젝트 라이선스는 아직 결정되지 않았습니다.
