# tasq — Product Concept

> AI-native하고 확장 가능한 터미널 태스크 매니저

- Status: Draft
- Date: 2026-06-06

## 1. 배경

기존 터미널 기반 태스크 관리 도구들은 태스크 CRUD와 뷰(테이블·간트차트 등)는 잘 갖추고 있지만, 다음 영역이 비어 있다.

| 영역 | 기존 도구들의 현황 |
|---|---|
| AI 연동 | MCP 연동 수준에 그침. 태스크 → 에이전트 위임 워크플로우 없음 |
| 확장성 | 플러그인 아키텍처·훅 시스템 없음 |
| 외부 서비스 연동 | GitHub/Jira 등 동기화 없거나 토큰 발급이 번거로움 |
| 분석/리포팅 | 기본적인 시간 추적 수준 |

tasq는 이 네 가지를 핵심 가치로 삼는 새 앱이다.

## 2. 포지셔닝

tasq는 단순한 태스크 매니저가 아니라 **태스크를 AI 에이전트에게 위임하고 그 전체 사이클을 관제하는 허브**다.

차별화 축 4개:

1. **AI 양방향 라이프사이클** — 태스크에서 바로 AI 에이전트 세션을 띄우고(dispatch), 백그라운드 세션을 모니터링하고, 결과를 태스크로 회수
2. **플러그인 시스템** — Obsidian 모델(core plugin + community plugin)의 런타임 확장
3. **GitHub 동기화** — `gh` CLI 기반 core plugin. PAT 발급 불필요
4. **생산성 리포팅** — 뭐가 진행을 막았는지까지 보이는 분석

## 3. 목표 / 비목표

### 목표

- 개인용 로컬 퍼스트 태스크 관리 (CLI + TUI)
- 태스크 → AI 에이전트 세션 위임의 완결된 라이프사이클
- 커뮤니티가 플러그인을 만들 수 있는 안정적인 SDK
- 일보/주보 재료로 바로 쓸 수 있는 리포트 출력

### 비목표

- 팀 협업, 실시간 공유, 권한 관리
- 웹 UI / 모바일 앱
- 고도의 스케줄 최적화 알고리즘 (필요해지면 플러그인 영역)
- 상시 데몬 / 서버 프로세스

## 4. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 런타임 | Bun | TS 네이티브 실행, `bun:sqlite` 내장, 플러그인 런타임 import 용이 |
| TUI | Ink | React 모델로 TUI 구성, 컴포넌트 단위 확장성 |
| 저장소 | SQLite (`bun:sqlite`) | 외부 의존성 없음, 집계 쿼리·upsert 네이티브 |
| 개발 환경 | devbox | `devbox shell`만으로 bun 포함 온보딩 완료 |
| 테스트 | `bun test` | 추가 의존성 없음 |

## 5. 아키텍처

Bun workspace 모노레포. 상시 데몬 없음.

```
tasq/
├── devbox.json                  # bun은 devbox로 설치
├── packages/
│   ├── core/                    # 도메인 모델, SQLite, 이벤트 버스, 쿼리 엔진
│   ├── cli/                     # tasq CLI — 모든 커맨드 --json 지원
│   ├── tui/                     # Ink TUI (리스트/상세/대시보드/세션 모니터)
│   ├── plugin-sdk/              # 플러그인 공개 API (npm publish 대상)
│   └── core-plugins/
│       └── github/              # gh CLI 동기화 (SDK 위에서 dogfooding)
└── docs/
```

핵심 원칙:

- **CLI가 곧 에이전트 인터페이스.** AI 에이전트와 외부 스크립트는 전부 `tasq ... --json`으로 일한다. "AI 친화적"의 실체는 markdown 파일이 아니라 좋은 CLI다 (`gh`가 증명한 모델).
- **TUI는 core를 직접 사용.** CLI를 거치지 않고 같은 도메인 계층을 공유.
- **core-plugins는 SDK 위에서 구현.** 자체 플러그인을 dogfooding하면서 SDK를 안정화.

### 사용자 디렉토리 레이아웃

설정·플러그인·데이터는 전부 `~/.tasq/` 아래로 통일한다.

```
~/.tasq/
├── config.json                  # 전역 설정 (활성 플러그인, mux 백엔드, 어댑터 기본값 등)
├── tasq.db                      # SQLite 데이터베이스
└── plugins/                     # community plugin 설치 위치
    └── <plugin-id>/
        ├── plugin.json          # manifest
        └── index.ts             # entry point (Bun이 TS 그대로 로드)
```

## 6. 데이터 모델

SQLite 단일 source of truth. 주요 테이블:

| 테이블 | 내용 |
|---|---|
| `tasks` | id, title, body(markdown), status, priority, tags, project, due, external_ref, timestamps |
| `events` | append-only 이벤트 로그 — task_id, type, payload(JSON), ts. 상태 전이·블록·세션 기록 전부 |
| `agent_sessions` | task_id, adapter, mux 세션명, status(running/waiting_input/done/failed), 결과 요약, timestamps |
| `plugin_kv` | 플러그인별 네임스페이스 key-value 저장소 |

설계 포인트:

- **`events`가 시스템의 척추.** 리포팅(체류시간·처리량·블로커 분석)과 플러그인 이벤트 훅이 같은 로그를 소비한다.
- **`external_ref`로 외부 데이터 upsert.** GitHub 이슈 등 외부 소스 동기화 시 중복 생성 없이 갱신.
- 태스크 상태 머신: `todo → in_progress → review → done` + `blocked` (+ in_progress의 위임 변형 `delegated`).

## 7. AI 세션 라이프사이클

데몬 없이 양방향을 구현한다.

```
tasq agent run <task-id>
  1. 어댑터가 태스크 컨텍스트(제목/본문/연결된 GitHub 이슈)를 프롬프트로 직렬화
  2. mux 백엔드(tmux/cmux)에 백그라운드 세션 생성, 에이전트 실행
  3. agent_sessions에 기록, 태스크 상태 → in_progress(delegated)
```

- **모니터링**: TUI 세션 패널이 mux 세션 존재/출력을 폴링해서 running/waiting_input/dead를 표시. 세션 attach 단축키 제공.
- **결과 회수**: 에이전트가 종료 시 `tasq agent report <task-id> --status done --summary "..."`를 호출하도록 어댑터가 설정 (Claude Code의 경우 Stop hook 또는 프롬프트 말미 지시). 콜백이 누락된 채 세션이 죽으면 폴링이 감지해서 태스크를 `review` 상태로 폴백 — 결과 유실 없이 사람이 확인하는 흐름 보장.
- **어댑터 인터페이스** (플러그인으로 추가 가능):
  - `buildPrompt(task, context)` — 태스크 → 프롬프트 직렬화
  - `spawnCommand(prompt, options)` — 실행할 커맨드 구성
  - `setupHooks(taskId)` — 결과 콜백 연결
- **mux 백엔드 추상화**: tmux 기본, cmux 선택. 세션 생성/조회/kill/attach만 추상화하면 됨.
- 내장 어댑터는 Claude Code. codex, gemini-cli 등은 플러그인으로.

## 8. 플러그인 시스템

Obsidian 모델을 따른다.

- **core plugins**: 앱에 번들, 설정에서 토글 (GitHub 플러그인이 첫 사례)
- **community plugins**: `~/.tasq/plugins/<id>/`에 설치, 런타임 import. Bun이라 TS를 빌드 없이 그대로 로드 가능
- **manifest** (`plugin.json`): id, name, version, 요구 SDK 버전, 사용 extension point 선언

### Extension points

registry 패턴으로 구현해서 종류 자체를 추후 확장 가능하게 한다. v1에서 여는 것:

| Extension point | API | 용도 |
|---|---|---|
| 데이터 소스 | `registerDataSource()` | 외부 데이터 ↔ 태스크 동기화 (GitHub 플러그인이 이 타입) |
| 이벤트 훅 | `on(event, handler)` | 태스크 생성/완료/상태변경 등에 반응 |
| 에이전트 어댑터 | `registerAgentAdapter()` | 새 AI 에이전트 타입 추가 |
| CLI 커맨드 | `registerCommand()` | `tasq <custom>` 서브커맨드 등록 |

추후 후보: TUI 뷰/위젯 주입, 리포트 섹션 추가.

### 안정성 원칙

- 플러그인은 **DB 직접 접근 금지, SDK API로만** 데이터를 다룬다 — 스키마 변경으로부터 생태계 보호
- SDK는 semver로 버전 관리, manifest의 요구 버전과 호환성 체크
- 플러그인 영속 데이터는 `plugin_kv` 네임스페이스 사용

## 9. GitHub core plugin

- `gh` CLI를 래핑 — 인증은 gh가 이미 해결했으므로 **PAT 발급 불필요**
- assign된 이슈/PR을 태스크로 pull. `external_ref` 기반 upsert라 재실행해도 중복 없음
- 양방향 액션(태스크 완료 시 이슈 닫기 등)은 옵트인
- AI dispatch 시 연결된 이슈 본문·코멘트가 컨텍스트에 자동 포함 → **"이슈에서 바로 에이전트 투입"이 한 동작**

## 10. 리포팅

`events` 로그 기반이라 별도 계측 없이 가능한 것들:

- **`tasq report week`** — 완료/진행/이월 태스크 + 상태별 체류시간 + AI 위임 내역을 markdown으로 출력. 일보·주보 재료로 바로 사용
- **TUI 대시보드** — 완료율, 처리량 추이, 태그/프로젝트별 분포를 문자 기반 차트로
- **블로커 분석** — blocked 체류시간 상위 태스크, 오래 묶여 있는 태스크, 이월이 반복되는 태스크 → "이번 주 생산성을 뭐가 막았나"에 답하는 뷰
- **AI 세션 통계** — 위임 횟수, 성공/재작업률, 에이전트별 분포

## 11. 로드맵

| Phase | 내용 | 검증 포인트 |
|---|---|---|
| 1 | core + CLI: CRUD, `--json`, 이벤트 로그, `~/.tasq/` 부트스트랩 | AI 에이전트가 CLI만으로 태스크를 다룰 수 있는가 |
| 2 | TUI 기본 뷰 + `agent run`/`agent report` (양방향 1차) | 태스크 → Claude Code 세션 → 결과 회수가 한 사이클로 도는가 |
| 3 | plugin-sdk + GitHub core plugin | 외부 개발자 관점에서 SDK만으로 플러그인을 만들 수 있는가 |
| 4 | 리포팅(week report + TUI 대시보드) + 세션 모니터 고도화 | 주간 리뷰를 tasq 출력만으로 쓸 수 있는가 |

## 12. 미해결 질문

- **프로젝트 스코프**: 태스크의 `project` 필드로 충분한가, repo별 로컬 컨텍스트(cwd 기반 자동 필터)가 필요한가
- **community plugin 배포 UX**: 설치를 git clone 수동으로 시작할지, `tasq plugin install <repo>` 커맨드와 레지스트리(카탈로그 repo)까지 갈지
- **cmux 지원 시점**: tmux 우선으로 가고 cmux는 백엔드 인터페이스만 확보해둘지
- **waiting_input 감지**: 에이전트가 사용자 입력을 기다리는 상태를 mux 출력 폴링만으로 신뢰성 있게 감지할 수 있는지 (어댑터별 휴리스틱 필요 가능성)
