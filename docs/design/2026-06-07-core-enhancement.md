# tasq core 기능 보강 설계 (Batch A/B/C)

- Status: Draft
- Date: 2026-06-07
- 관련 문서: [concept.md](./concept.md), [Phase 1 구현 계획](../plans/2026-06-06-phase1-core-cli.md)

## 1. 배경

Phase 1(core + CLI)을 마친 시점에서 taskwarrior·taskdog와 기능 인벤토리를 비교한 결과, TUI(Phase 2)에 앞서 core를 보강하기로 했다. 주요 갭:

- **taskwarrior 대비**: 상대/명명 날짜 파싱, 라이프사이클 단축 커맨드, 복수 ID(bulk), annotations, dependencies, 필터 표현력, urgency 자동 정렬, undo, recurrence
- **taskdog 대비**: soft delete + restore, cancel 상태, 의존성 순환 탐지, 단순 스케줄링(estimated_duration 기반)
- **추가 요구**: sub-task 트리 — AI 에이전트가 태스크를 재귀 분해하는 유스케이스의 기반

전체를 3개 배치로 나누고, 각 배치는 독립된 spec 섹션 → plan → PR 사이클로 진행한다.

| 배치 | 내용 | 성격 |
|---|---|---|
| **A. 일상 사용성 + 구조** | 날짜 파싱, 라이프사이클 커맨드, 필터 강화, note, dependencies, sub-task, cancelled, soft delete + restore | Phase 2(AI 양방향)의 기반. 최우선 |
| **B. 신뢰성 + 자동화** | urgency 정렬, undo, recurrence | 이벤트 스파인 활용 |
| **C. 고급 워크플로우** | wait/until, context, export, UDA, 단순 스케줄링 | hooks는 제외 — Phase 3 플러그인 시스템이 본체 |

## 2. 확정된 설계 결정

| 결정 | 내용 | 근거 |
|---|---|---|
| 스케줄링 | 단순 greedy 1종만 core 포함. 알고리즘군(유전/몬테카를로 등)은 플러그인 영역 | 차별화 축이 아님. concept.md 비목표 문구를 이에 맞게 수정 |
| sub-task 깊이 | `parent_id` 무제한 트리. 순환만 차단 | AI의 재귀 분해에 자연스러움. 스키마는 깊이 제한과 무관 |
| 부모 done | 미완료 자식 존재 시 **에러로 차단**. 우회 플래그 없음 | AI 에이전트가 상태를 신뢰할 수 있어야 함 |
| 부모 rm | 자식 존재 시 차단, `--recursive`로 명시 삭제 | 실수 방지와 명시성 |
| blocked 의미론 | 계산형(deps 기반)과 수동 status 공존 | 선행 대기와 외부 요인 대기는 다른 정보. 선행 완료 시 자동 복구 로직 불필요 |
| rm 의미론 | Batch A부터 soft delete 기본 + `--hard`. restore도 A에 포함 | 사용자 없는 지금이 의미론 전환의 최저 비용 시점. 복구 수단 없는 soft delete는 무의미하므로 restore 동반 |
| 스케줄 출력 | 제안 테이블 출력 + `--apply` 시 start 필드 기록 | 새 테이블 없이 기존 스키마로 해결. 간트는 start~due 범위로 충분 |
| undo | 이벤트를 지우지 않고 `reverted` 이벤트 추가 | append-only 철학 유지 |
| recurrence | rolling 방식 — done 시점에 다음 인스턴스 1개 생성 | taskwarrior식 템플릿+mask보다 단순하고 이벤트 로그와 궁합 좋음 |

## 3. 공통 기반

### 3.1 마이그레이션 러너

현재 `openDb()`는 `CREATE TABLE IF NOT EXISTS` + `user_version = 1` 고정이다. 버전드 마이그레이션으로 전환한다.

- `user_version`을 읽고, 현재 버전보다 큰 마이그레이션을 순서대로 적용
- 각 마이그레이션은 트랜잭션으로 감싼다
- 신규 DB는 v1부터 전부 순차 적용 (스냅샷 DDL 별도 유지 안 함 — 단일 경로)
- 배치별 버전: Batch A → v2, Batch B → v3, Batch C → v4

#### 스키마 진화 전략 — 변경 코스트를 낮게 유지하기

단일 라이터 로컬 앱이라 앱과 DB가 항상 함께 업그레이드된다. 서버 시스템의 호환성 윈도우(구버전 클라이언트 공존, 무중단 전환)가 없으므로 expand-then-contract 같은 패턴은 불필요하다. 그 위에 다음 장치로 변경 비용을 묶어둔다.

- **접점 단일화**: SQL은 core의 store 계층에만 존재. CLI/TUI는 도메인 타입으로만 일하고, 플러그인은 DB 직접 접근 금지(SDK만) — 스키마 변경의 파급 범위를 core 한 곳으로 고정
- **마이그레이션 전 자동 백업**: 버전 업 직전 `~/.tasq/backups/tasq-v<N>.db`로 스냅샷. 실패한 마이그레이션은 복원으로 회수
- **다운그레이드 보호**: `user_version`이 앱이 아는 최신 버전보다 높으면 열기를 거부 (구버전 바이너리가 신 스키마를 손상시키는 것 방지)
- **additive-first**: 새 필드는 nullable `ADD COLUMN` 우선 (SQLite에서 테이블 재작성 없음). 드롭/타입 변경 등 파괴적 변경만 테이블 재구축 패턴 사용
- **이벤트 payload는 마이그레이션 대상 외**: 리더가 모르는 필드는 무시(additive), 의미가 바뀌면 새 이벤트 타입을 만든다
- **연성 필드는 UDA로 흡수**: "필드 하나 추가" 요구의 상당수는 DDL 없이 UDA(6.5)로 해결 가능
- **ORM 재평가 트리거 유지**: 마이그레이션 5~6개 누적 또는 수동 매핑 버그 발생 시 Drizzle(drizzle-kit) 도입을 재평가

### 3.2 날짜 파싱 (`packages/core/src/dates.ts`)

CLI/TUI가 공유하므로 core에 둔다. 순수 함수로 `now`를 주입받아 테스트를 단순화한다.

```ts
parseDateExpr(expr: string, now: Date): string  // ISO date(YYYY-MM-DD) 반환, 실패 시 InvalidDateExprError
```

- 날짜는 **date-only**(YYYY-MM-DD)로 통일. 시각은 다루지 않는다
- 모든 상대 표현은 **미래(오늘 이후) 시점**으로 해석. 예외는 `yesterday`(필터·지각 입력용)

| 형태 | 예 | 해석 |
|---|---|---|
| ISO | `2026-07-01` | 그대로 (유효성 검증) |
| 명명 | `today` / `tomorrow` / `yesterday` | 오늘 / +1일 / −1일 |
| 요일 | `mon` ~ `sun`, `monday` ~ | 다음 발생. 오늘과 같은 요일이면 +7일 |
| 상대 | `3d` / `2w` / `1m` / `1y` | 오늘 + N일/주/달/년 |
| 기간 끝 | `eow` / `eom` / `eoy` | 이번 주 일요일 / 이번 달 말일 / 12-31 |
| 기간 시작 | `sow` / `som` / `soy` | 다음 주 월요일 / 다음 달 1일 / 내년 1-1 |

- 주의 시작은 월요일
- 적용 지점: `add`/`update`의 `start`/`due`(+이후 `wait`/`until`), `list`의 날짜 필터, `schedule`의 `--from`

### 3.3 이벤트 타입 확장

| 타입 | 배치 | payload |
|---|---|---|
| `created` | 기존 | (기존 유지, recurrence 생성 시 `recurredFrom` 추가) |
| `updated` | A에서 강화 | `{ fields: { <field>: { from, to } } }` — **before/after 기록**. Batch B undo의 데이터 소스 |
| `status_changed` | 기존 | `{ from, to }` (기존 그대로) |
| `comment` | A | `{ text }` — note 커맨드, 추후 agent report |
| `dep_added` / `dep_removed` | A | `{ dependsOnId }` — 블로커 분석·undo의 데이터 소스 |
| `archived` | A | `{ reason?: "until" }` — soft delete. until 만료 sweep도 동일 타입 |
| `restored` | A | `{}` |
| `deleted` | 기존 | `--hard` 시에만 |
| `reverted` | B | `{ targetEventId }` — undo |

actual 시각(실제 시작/종료)은 별도 컬럼 없이 `status_changed` 이벤트의 `created_at`에서 유도한다.

## 4. Batch A — 일상 사용성 + 구조

### 4.1 스키마 v2

```sql
ALTER TABLE tasks ADD COLUMN parent_id INTEGER;   -- sub-task 트리
ALTER TABLE tasks ADD COLUMN archived_at TEXT;    -- soft delete 마커 (status와 직교)

CREATE TABLE task_deps (
  task_id INTEGER NOT NULL,
  depends_on_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX idx_deps_depends_on ON task_deps(depends_on_id);
```

status에 `cancelled` 추가 (TEXT 컬럼이라 DDL 변경 없음, TS 타입만).

### 4.2 라이프사이클 커맨드

| 커맨드 | 전이 | 비고 |
|---|---|---|
| `tasq done <id...>` | todo/in_progress/review/blocked → done | 미완료(todo/in_progress/review/blocked) 자식 존재 시 에러. done/cancelled 자식은 OK. cancelled에서 done은 불가 — reopen 먼저 |
| `tasq start <id...>` | todo/review/blocked → in_progress | 선행 미완료 시 **경고만**(stderr) 출력하고 진행. Phase 2의 에이전트 dispatch는 차단 |
| `tasq cancel <id...>` | done 이외 → cancelled | |
| `tasq reopen <id...>` | done/cancelled → todo | |

- **복수 ID는 단일 트랜잭션**: 하나라도 실패하면 전체 롤백 + exit 1. `rm`/`restore`/`status`도 복수 ID 지원. `show`/`events`/`update`/`note`는 단일 유지
- done 가드는 TaskStore의 `setStatus` 경로에 구현 — `tasq status <id> done` 우회도 동일하게 차단

### 4.3 필터 강화 (`list`)

| 플래그 | 의미 |
|---|---|
| `--due-before <expr>` / `--due-after <expr>` | 날짜 표현 적용. due 없는 태스크는 제외 |
| `--overdue` | due < today 이고 done/cancelled 아님 |
| `--tag <t>` 복수 | AND 결합 |
| `--search <text>` | title + body LIKE 부분 일치 |
| `--ready` | status todo + deps 전부 충족 + archived 아님 |
| `--all` | archived 포함 (기본은 제외) |

### 4.4 annotations — `tasq note <id> <text>`

- `comment` 이벤트 append. 태스크 row는 변경하지 않음 (updated_at도 그대로)
- `show`에 노트 목록(타임스탬프 + 텍스트) 표시, `events`에도 노출
- Phase 2의 `agent report`가 같은 통로로 진행 보고를 남긴다

### 4.5 dependencies

- `tasq dep add <id> <on-id...>` / `tasq dep rm <id> <on-id>` — 각각 `dep_added`/`dep_removed` 이벤트 기록
- **순환 탐지**: DFS로 자기 자신 도달 검사, 발견 시 `DependencyCycleError`. 자기 참조 금지
- **blocked 계산**: 선행 중 done/cancelled가 아니고 archived도 아닌 것이 있으면 blocked. archived 선행은 차단에서 제외 (사라진 태스크가 영원히 막는 것 방지)
- list에서 blocked 태스크에 마커 표시, `--ready`에서 제외
- `--hard` 삭제 시 해당 태스크가 걸린 `task_deps` row(양방향) 정리. soft delete는 row 유지 (restore 대비)

### 4.6 sub-task

- `tasq add "..." --parent <id>` / `tasq update <id> --parent <id|none>`
- nullable 필드 클리어는 `none`으로 통일: `--parent none`, `--project none`, `--due none`, `--start none` (+ 이후 `--recur none` 등) — PR #3 후속 과제였던 null 클리어 UX를 이 컨벤션으로 해소
- **순환 차단**: parent 변경 시 조상 체인을 걸어 자기 자손을 부모로 설정하는 것을 거부. 자기 참조 금지
- **list 트리 렌더링**: 기본 list는 부모 아래 자식을 들여쓰기로 표시. **필터/검색 사용 시 자동 flat** (부분 매치 트리의 표시 모호성 회피), `--flat`으로 강제 가능
- 부모 done 차단은 4.2 참조

### 4.7 rm soft delete + restore

- `tasq rm <id...>`: `archived_at` 설정 + `archived` 이벤트. 자식 존재 시 차단, `--recursive`(-r)로 서브트리 전체 archive
- `tasq rm --hard <id...>`: 영구 삭제 + `deleted` 이벤트 (이벤트는 잔존). `--hard --recursive` 조합 가능. deps row 정리 포함
- `tasq restore <id...>`: archived 해제 + `restored` 이벤트. **부모가 archived면 에러** — 메시지에 "부모 #N을 먼저 restore" 안내 (차단-지향 일관성)
- list 기본은 archived 제외, `--all`로 포함

### 4.8 CLI 표면 요약 (A)

```
tasq done|start|cancel|reopen <id...>
tasq note <id> <text>
tasq dep add <id> <on-id...> / tasq dep rm <id> <on-id>
tasq add "..." [--parent <id>] [--due <expr>] [--start <expr>] ...
tasq rm [-r] [--hard] <id...> / tasq restore <id...>
tasq list [--due-before|--due-after <expr>] [--overdue] [--tag <t>]... [--search <q>] [--ready] [--all] [--flat]
```

## 5. Batch B — 신뢰성 + 자동화

### 5.1 urgency

가중합으로 계산하는 파생값 (저장 안 함):

```
urgency = 4.0 × (status == in_progress)
        + due_term            # due 임박도: 14일 전 0 → 당일 12.0 선형, 초과 시 12.0 고정
        + 1.0 × priority      # 숫자 priority 그대로 계수 1.0
        + age_term            # 생성 후 365일에 걸쳐 0 → 2.0 선형, 이후 고정
        − 5.0 × (deps에 의한 blocked)
        − 3.0 × (status == blocked)
```

- 상수는 코드 고정. 설정화는 config 시스템 도입 시(추후)
- `list` 기본 정렬을 urgency desc로 전환, `--sort id|priority|due|urgency` 제공
- `--json` 출력에 `urgency` 필드 포함

### 5.2 undo

- `tasq undo`: 마지막 mutation 이벤트 1개를 역적용. 반복 호출로 거슬러 올라감
- `reverted` 이벤트(`{ targetEventId }`)를 append — 원본 이벤트는 지우지 않음. reverted 처리된 이벤트와 `reverted` 자신은 undo 대상에서 스킵
- 역적용 매핑:

| 대상 이벤트 | 역적용 |
|---|---|
| `created` | 태스크 row 삭제 (마지막 이벤트이므로 후속 이력 없음이 보장됨) |
| `updated` | `fields`의 `from` 값으로 역패치 |
| `status_changed` | status를 `from`으로 복원 |
| `comment` | reverted 마킹 — show/events 기본 표시에서 숨김 |
| `dep_added` / `dep_removed` | 해당 deps row 삭제 / 재추가 |
| `archived` | restore |
| `restored` | archive |
| `deleted` | **복구 불가 — 에러** ("hard delete는 되돌릴 수 없음") |

### 5.3 recurrence (rolling)

- 스키마 v3: `ALTER TABLE tasks ADD COLUMN recur TEXT;` — 기간 표현(`1d`/`2w`/`1m`/`1y`)
- `add`/`update`에 `--recur <duration>`. **due 없는 태스크에 recur 설정은 에러**
- done 처리 시: `recur` 있으면 다음 인스턴스 1개 생성. TaskStore의 setStatus 경로에 구현 — `done`/`status <id> done` 어느 쪽이든 동일 (4.2의 가드와 같은 위치)
  - 복사: title, body, tags, project, priority, recur, parent_id (반복 sub-task는 같은 부모 아래 유지 — 부모 done 차단이 자연스럽게 적용됨)
  - due = 기존 due + recur, start = 설정돼 있으면 기존 start + recur
  - **복사 안 함**: deps, sub-task 서브트리, externalRef
  - 새 태스크의 `created` 이벤트 payload에 `recurredFrom: <원본 id>`
- 끊기: `tasq update <id> --recur none`. cancel은 다음 인스턴스를 생성하지 않음

## 6. Batch C — 고급 워크플로우

### 6.1 스키마 v4

```sql
ALTER TABLE tasks ADD COLUMN wait TEXT;
ALTER TABLE tasks ADD COLUMN until TEXT;
ALTER TABLE tasks ADD COLUMN estimated_duration REAL;  -- 시간(hours)

CREATE TABLE uda_defs (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'string' | 'number' | 'date'
  label TEXT NOT NULL
);

CREATE TABLE task_udas (
  task_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (task_id, name)
);

CREATE TABLE contexts (
  name TEXT PRIMARY KEY,
  filter TEXT NOT NULL           -- TaskFilter JSON 직렬화
);

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,          -- 'active_context' 등
  value TEXT NOT NULL
);
```

### 6.2 wait / until

- `wait`: 해당 날짜까지 기본 list에서 숨김 (`--all`로 표시). status는 건드리지 않음
- `until`: 지난 태스크는 **lazy sweep**으로 자동 archive — CLI 커맨드 시작 시점에 만료분 일괄 처리 (`archived` 이벤트, `reason: "until"`). 상시 데몬 없음 원칙 유지
- recurrence와 연동: recur 태스크의 due + recur가 until을 넘으면 다음 인스턴스를 생성하지 않음 (recurrence 종료 수단)

### 6.3 context

- `tasq context define <name> <필터 플래그...>` / `tasq context <name>` / `tasq context none` / `tasq context list`
- 정의는 `contexts` 테이블, 활성 컨텍스트는 `app_config`
- 적용 대상: `list`, `export`, `schedule` 등 **컬렉션 읽기** 커맨드. `show`/`events`처럼 ID 직접 지정 커맨드는 미적용
- 활성 컨텍스트가 있으면 출력 하단에 안내 1줄 표시

### 6.4 export

- `tasq export --format json|csv|markdown` + list와 동일한 필터 플래그
- csv는 RFC 4180 이스케이프, markdown은 테이블. json은 `list --json`과 동일 구조

### 6.5 UDA

- `tasq uda define <name> --type string|number|date [--label <l>]` / `tasq uda list`
- 값 설정: `add`/`update`에 `--set <name>=<value>` (반복 가능). date 타입은 parseDateExpr 통과, number는 숫자 검증
- `show`에 표시, `list --uda <name>=<value>` 동등 필터
- Phase 3 플러그인의 커스텀 필드 저장소로 재사용 예정

### 6.6 단순 스케줄링

- 입력: `add`/`update`에 `--estimate <hours>`
- `tasq schedule [--from <expr>=today] [--hours-per-day <N>=6] [--apply]`
- 대상: status todo/in_progress, archived 제외, `estimated_duration` 있는 태스크. wait가 미래면 wait 이후부터 배분
- 알고리즘 (greedy 1종):
  1. due 임박 순(없으면 마지막) → priority desc → id 순 정렬
  2. `--from`부터 **평일에만** forward 배분. 일일 잔여 = hours-per-day − 그날 이미 배분된 시간
  3. due를 넘겨야 배분이 끝나는 태스크는 경고 목록에 표시
- 출력: 날짜 × 태스크 배분 테이블 + 경고. `--apply` 시 각 태스크의 **첫 배분일을 start에 기록** (updated 이벤트)
- daily allocation 저장 테이블 없음 — "단순 버전" 취지. 그 이상은 플러그인 영역

## 7. concept.md 반영 사항

- 비목표 수정: "고도의 스케줄 최적화 알고리즘" → "고도의 스케줄 최적화 알고리즘군(유전/몬테카를로 등) — core는 단순 greedy 1종까지, 그 이상은 플러그인 영역"
- 데이터 모델: tasks 필드 목록에 parent_id/archived_at/recur/wait/until/estimated_duration, 테이블에 task_deps/uda_defs/task_udas/contexts/app_config 추가. 상태 머신에 cancelled 추가
- 로드맵: Phase 1과 2 사이에 core 보강(본 문서) 삽입

## 8. 테스트 전략

- 커버리지 100% 게이트 유지 (bunfig coverageThreshold = 1.0)
- `dates.ts`는 `now` 주입으로 경계 케이스(월말, 연말, 윤년, 요일 래핑)를 결정적으로 테스트
- 마이그레이션: v1 스키마 DB를 만들어 v2/v3/v4 순차 적용 후 데이터 보존 검증
- 복수 ID 트랜잭션: 일부 실패 시 전체 롤백 검증
- 순환 탐지: deps·parent 각각 직접 순환/간접 순환/자기 참조
- E2E는 기존 방침대로 스모크 1개 유지 (배선 검증), 로직은 단위 테스트

## 9. 미해결 질문

- urgency 상수의 설정화 시점 (config 시스템은 플러그인 토글 때 함께 들어올 가능성)
- `--search`의 FTS5 전환 기준 (LIKE로 시작, 태스크 수천 건 수준에서 재평가)
- UDA와 플러그인 네임스페이스 충돌 규칙 (Phase 3 SDK 설계 시 결정)
