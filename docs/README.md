# 문서 안내

이 저장소는 단계 0의 확장 골격을 구현 중이다. 모든 설계와 테스트 항목은 실제 구현·검증 전까지 제안이며 테스트 완료를 뜻하지 않는다.

| 문서 | 역할 |
| --- | --- |
| [기능 요구사항](video-editor-requirements.md) | MVP 범위와 사용자에게 제공할 기능 |
| [사용자 시나리오](feature-scenarios.md) | 작업 흐름, 예외와 테스트 연결 |
| [UI 가이드](ui-guide.md) | Preview·Edit 화면과 접근성 |
| [상세 설계](detailed-design.md) | 시간·편집·미디어 처리의 구현 계약 |
| [컴포넌트 가이드](component-guide.md) | 구성 요소의 책임과 상태·메시지 경계 |
| [미디어 엔진 배포와 연동](media-engine-distribution.md) | 사용자 설치 FFmpeg 연동 및 배포 선택지 |
| [단계 0 의존성 검토](dependency-review.md) | 시험용 VSIX와 개발 의존성 확인 결과 |
| [플랫폼 검증 계획](platform-validation.md) | Windows·macOS 등 미실행 검증과 기록 기준 |
| [엔진 검증 기록](engine-validation.md) | 실제 FFmpeg 구성 및 코덱 테스트 결과 |
| [코덱 라이선스 비교](codec-license-comparison.md) | 후보별 기능과 라이선스 참고 자료 |
| [구현 계획](implementation-plan.md) | 단계별 작업과 완료 조건 |
| [구현 준비 현황](implementation-readiness.md) | 확인한 개발 환경과 첫 구현 단위 |
| [테스트 체크리스트](test-checklist.md) | 테스트 식별자, 미실행 항목과 기록 기준 |
| [에이전트 지침](agent-guide.md) | 저장소 작업 규칙 |

사용자 지시가 우선한다. 요구사항 변경 시 관련 설계·시나리오·계획·테스트를 함께 수정하며, 기술 계약은 상세 설계를 기준으로 한다. 미결정 항목은 검증 결과로 확정하기 전 지원되는 기능으로 표시하지 않는다.
