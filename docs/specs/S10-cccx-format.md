# S10: CCCX v1 이식 포맷

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D83, ADR-0042 D84는 Supabase 사전 점검 범위만 보존, `CCC_OPEN_PILOT_PLAN.md` SG10/E3-7
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `CCC_OPEN_PILOT_PLAN.md`, S1 Database 포트, S9 Secrets/Recovery Kit
- 산출: 이 문서의 CCCX v1 계약. 구현 산출물과 실제 복원 증거는 E3-7이 소유한다.
- 관련 티켓: E3-7

## 1. 목적

`.cccx` 하나로 Community Cloud, Local Single, Local Office 사이의 백업·복구와 모드 이전을 수행한다. 암호화된 결정론적 payload, 스키마·행·첨부 hash, 대상 설치 금고 키로의 재암호화를 한 계약으로 묶어 잘못된 암호·변조·호환 불가·디스크 장애가 있어도 원본을 지킨다. `확정`은 계약과 fixture·검증 명령을 닫는 상태이며 구현 완료를 뜻하지 않는다.

## 2. 외부 envelope와 암호 규칙

### 2.1 바이트 형식

파일은 다음 순서의 단일 바이트 스트림이다. 모든 정수는 unsigned big-endian이다.

```
magic[5] || headerLength[4] || headerUtf8[headerLength] || ciphertext[*]
```

- `magic`은 정확히 `43 43 43 58 01` (`CCCX` + version 1)이다. 다른 값·version은 `UNSUPPORTED_FORMAT`이다.
- `headerLength`는 **1 이상 4,096 이하**이고, `headerUtf8`은 BOM 없는 UTF-8이다. 길이는 byte 수이며 header JSON의 앞뒤 공백은 없다.
- `headerUtf8`은 RFC 8785 JSON Canonicalization Scheme(JCS)로 직렬화한 정확한 bytes여야 한다. 중복 key, unknown key, non-finite number, non-canonical 재직렬화 결과는 `INVALID_HEADER`다.
- ciphertext는 AES-GCM ciphertext 뒤 16-byte authentication tag를 붙인 값이다. header 뒤의 모든 byte가 ciphertext이며 별도 trailer는 없다. ZIP/암호문이 0 byte이거나 tag 미만이면 거부한다.

정본 header 스키마는 다음과 같다. `salt`와 `nonce`는 **padding 없는 case-sensitive base64url**이고, hash는 이 header에 넣지 않는다.

```json
{"cipher":{"name":"AES-256-GCM","nonce":"<base64url 12 bytes>","tagBytes":16},"formatVersion":1,"kdf":{"iterations":3,"memoryKiB":65536,"name":"Argon2id","outputBytes":32,"parallelism":1,"salt":"<base64url 16 bytes>"}}
```

허용 key와 값은 예시의 것만이며 `formatVersion=1`, KDF 이름·수치, cipher 이름·tagBytes를 정확히 검사한다. salt와 nonce는 매 export마다 CSPRNG로 새로 만든다. passphrase는 UTF-8 NFC로 정규화하고 Unicode scalar 16자 미만이면 `PASSPHRASE_TOO_SHORT`로 거부한다.

Golden header vector는 salt bytes `00..0f`, nonce bytes `00..0b`를 사용한다. canonical UTF-8 header의 길이는 `216`(`00 00 00 d8`)이고, 아래 문자열과 byte-for-byte 일치해야 한다.

```text
{"cipher":{"name":"AES-256-GCM","nonce":"AAECAwQFBgcICQoL","tagBytes":16},"formatVersion":1,"kdf":{"iterations":3,"memoryKiB":65536,"name":"Argon2id","outputBytes":32,"parallelism":1,"salt":"AAECAwQFBgcICQoLDA0ODw"}}
```

이 vector의 file prefix는 `43 43 43 58 01 00 00 00 d8` 뒤 위 UTF-8 bytes다. golden fixture는 이 값에서 header byte를 한 번씩 바꾼 case도 포함한다.

1. Argon2id v1.3으로 passphrase, salt, `memoryKiB=65536`, `iterations=3`, `parallelism=1`, `outputBytes=32`를 사용해 32-byte key를 파생한다.
2. AAD는 `headerUtf8`의 원본 byte 그대로다. magic과 headerLength는 AAD에 넣지 않는다.
3. AES-256-GCM으로 inner payload를 암호화하고 12-byte nonce와 16-byte tag를 사용한다. salt와 nonce는 인증된 header에만 persist하며 journal·log·DB import metadata·output 이름에는 쓰지 않는다.

복호화·인증 실패는 `DECRYPTION_FAILED`(화면에서는 “암호가 틀렸거나 파일이 변조되었습니다.”) 하나로 처리한다. GCM은 wrong password와 ciphertext 변조를 구별할 수 없으므로 둘을 구별한다고 주장하거나 재시도 oracle을 제공하지 않는다. Header 비정규화, tag 실패, inner payload digest 불일치, ZIP/member hash 불일치는 모두 변조로 간주하고 즉시 중단하며 import를 적용하지 않는다.

### 2.2 인증된 inner payload

암호화 전 plaintext는 ZIP 앞에 다음 32-byte digest를 붙인 값이다.

```
innerPayloadSha256[32] || deterministicZip[*]
```

`innerPayloadSha256`은 뒤따르는 deterministic ZIP bytes만 SHA-256한 raw 32-byte 값이며 ciphertext 안에만 있다. 복호화 후 먼저 digest와 ZIP byte를 확인한다. 따라서 평문 payload hash나 안정적인 payload fingerprint는 header, 파일명, journal, log에 노출되지 않는다. 이 envelope는 S9 Recovery Kit v1과 동일한 Argon2id/AES-GCM 파라미터를 사용하지만 CCCX의 magic, payload, header 필드는 서로 대체하지 않는다.

## 3. 결정론적 plaintext ZIP

복호화 payload의 ZIP은 다음 하드 cap과 구조를 따른다.

- archive byte 수는 `1..4,294,967,295`, member 수는 `1..65,535`, member uncompressed byte 수는 `0..536,870,912`, JSONL table 하나의 byte 수는 `<=2,147,483,647`, row 수는 `<=10,000,000`이다. 이 범위를 넘으면 `ZIP_LIMIT_EXCEEDED`다. ZIP64는 사용하지 않는다. zero-row JSONL과 zero-byte attachment member는 허용한다.
- 허용 member는 `manifest.json`, `data/<table>.jsonl`, `attachments/<64 lowercase hex sha256>`뿐이다. member name은 UTF-8 `/` 경로이고 `..`, 절대 경로, NUL, duplicate name, symlink·directory member는 금지한다.
- archive comparator는 `manifest.json`을 항상 첫 member로 하는 한 가지 예외를 두고, 나머지 member name은 raw UTF-8 byte 사전순으로 정렬한다. manifest를 첫 member로 두지 않거나 같은 이름이 두 번 나오면 거부한다.
- **Local file header**는 `versionNeeded=20`, `flags=0x0800`, `method=0`, DOS time/date epoch, CRC-32, compressed/uncompressed size, nameLength, `extraLength=0`을 각각 고정한다. local header에는 version-made-by, disk start, internal/external attributes, comment length field가 없으므로 그런 local field와 central field의 동등성을 요구하지 않는다.
- **Central directory entry**는 `versionMadeBy=0x0314`(Unix, ZIP 2.0), `versionNeeded=20`, `flags=0x0800`, `method=0`, DOS time/date epoch, CRC-32, compressed/uncompressed size, nameLength, `extraLength=0`, `commentLength=0`, `diskStart=0`, `internalAttributes=0`, `externalAttributes=0`, 그리고 local-header-relative `offset`를 각각 고정한다. local과 central에서 실제로 존재하는 공통 field(name, flags, method, time/date, CRC, sizes, name/extra lengths)는 값이 byte-equivalent여야 한다.
- archive comment, extra field, data descriptor, padding, self-extracting prefix/suffix는 없다. central directory와 각 file data의 offset·size가 archive bounds 안에 있고 서로 겹치지 않아야 하며, EOCD는 정확히 archive의 마지막 bytes에 있는 단 하나의 record여야 한다. ZIP64 EOCD/locator와 trailing bytes는 거부한다.
- CRC-32은 검사하되 신뢰하지 않고 member bytes의 SHA-256을 다시 계산한다. ZIP parser는 path와 byte 범위를 검증한 뒤에만 member data를 읽는다.

`manifest.json`은 JCS bytes이며 payload 안에서 유일하다. descriptor와 member는 엄격한 one-to-one identity를 가져야 한다. 즉 각 table descriptor가 정확히 하나의 `data/<table>.jsonl` member에 대응하고, 각 attachment descriptor가 정확히 하나의 `attachments/<sha256>` member에 대응하며, 그 역방향도 성립해야 한다. 중복 table name, member, attachment sha, descriptor identity와 unlisted member는 `MANIFEST_INCOMPLETE`다.

### 3.1 manifest와 schema

```json
{"attachments":[{"bytes":0,"contentType":"application/octet-stream","member":"attachments/<sha256>","sha256":"<64 lowercase hex>"}],"exclusions":[{"name":"<schema registry name>","reason":"ephemeral|secret|lease"}],"manifestVersion":1,"migrationSet":{"ids":["0001_baseline"],"sha256":"<64 lowercase hex>"},"schemaDigest":"<64 lowercase hex>","schemaVersion":1,"sourceMode":"community-cloud|local-single|local-office","tables":[{"attachmentRefs":[{"column":"attachmentSha256","multiple":false,"required":false}],"columns":[{"identity":false,"name":"id","nullable":false,"pii":false,"secret":false,"type":"text"}],"foreignKeys":[{"columns":["ownerId"],"targetColumns":["id"],"targetTable":"users"}],"logicalSha256":"<64 lowercase hex>","member":"data/<table>.jsonl","memberSha256":"<64 lowercase hex>","name":"<table>","portableRowKey":null,"primaryKey":["id"],"rowCount":0}]}
```

- `schemaDigest`는 다음 **정확한 input object**를 JCS로 serialize한 SHA-256이다. 이 object에는 export 대상 schema의 semantic 정보만 넣고 row count/hash/member path는 넣지 않는다.

```json
{"schemaVersion":1,"tables":[{"attachmentRefs":[{"column":"attachmentSha256","multiple":false,"required":false}],"columns":[{"identity":false,"name":"id","nullable":false,"pii":false,"secret":false,"type":"text"}],"foreignKeys":[{"columns":["ownerId"],"targetColumns":["id"],"targetTable":"users"}],"name":"users","portableRowKey":null,"primaryKey":["id"]}]}
```

- `tables`는 table name raw UTF-8 bytes, `columns`는 column name raw UTF-8 bytes, `foreignKeys`·`attachmentRefs`는 descriptor의 JCS UTF-8 bytes 전체를 비교해 오름차순으로 정렬한다. `primaryKey`와 각 FK의 `columns`/`targetColumns`는 SQL 선언 순서를 보존한다. descriptor에 없는 semantic field, `pii`, `secret`, `identity`, attachment reference, FK를 생략하면 digest가 달라져 거부된다.
- schemaDigest input object의 각 table은 `portableRowKey` 필드를 반드시 포함한다. 안정적인 SQL PK를 쓰면 `null`이고, SQL PK가 없어 export 가능한 대체 키를 쓰면 `{"columns":["<column>"],"version":1}`이다. 이때 `primaryKey`는 해당 portableRowKey columns와 같은 nonempty tuple로 materialize되며, versioned portableRowKey 없이 export하지 않는다.
- 모든 portable table descriptor는 nonempty `primaryKey`를 가져야 한다. 안정적인 PK가 없는 table은 export 대상이 아니며, versioned `portableRowKey`가 schemaDigest input과 descriptor에 먼저 선언돼야 한다. PK가 없거나 빈 tuple이면 `SCHEMA_INCOMPATIBLE`이다.
- `migrationSet`의 `ids`는 target에 적용된 migration logical ID의 raw UTF-8 bytes 엄격 오름차순 목록이며 중복이 없다. `migrationSet.sha256`은 정확히 `JCS({"schemaVersion":1,"ids":["0001_baseline"]})`의 SHA-256으로 계산한다(실제 schemaVersion과 ids를 사용). target은 schemaVersion, schemaDigest, migrationSet digest와 migration parity를 모두 일치시켜야 하며 하나라도 모르면 `SCHEMA_INCOMPATIBLE`이다.
- canonical SQL logical type은 engine 표현을 그대로 내보내지 않는다. `int64`는 `int64:<signed decimal>` tagged string, `decimal`은 **`{"type":"decimal","coefficient":"<canonical signed integer>","scale":<unsigned integer>}` tagged object**로 표현한다. coefficient에는 leading zero가 없고 zero는 `"0"`이며 exponent를 쓰지 않는다. scale은 trailing-zero 의미를 보존한다. `blob`은 `blob:<unpadded case-sensitive base64url>` tagged string, `timestamp`는 `timestamp:<UTC RFC3339 with exactly six fractional digits>Z` tagged string으로 표현한다. text, boolean, null은 JSON native 값으로 표현하되 schema type과 일치해야 한다.
- `schemaVersion`은 target의 지원 범위 및 migration parity 안에 있어야 한다. target이 모르는 table/column/type, PK 정의 불일치, non-null 누락, duplicate PK, migration mismatch는 staging 전에 `SCHEMA_INCOMPATIBLE`다. 자동 migration·열 무시·unknown table 삭제를 하지 않는다.
- schema registry의 모든 portable table은 `tables`에 있어야 한다. secret/session/lease/ephemeral table은 `exclusions`에 이름과 고정 reason을 명시해야 하며 암묵적 누락은 `MANIFEST_INCOMPLETE`다. user data table은 exclusion할 수 없다.
- JSONL table은 zero row이면 정확히 zero bytes이고, row가 하나 이상이면 한 row당 JCS object 한 줄과 LF(`0a`)를 둔다. blank line은 없다. row 순서는 **nonempty typed** primary-key tuple(각 값은 schema의 canonical SQL logical type으로 normalize)을 JCS로 serialize한 raw bytes의 사전순이고 같은 tuple은 금지한다. 빈 tuple은 허용하지 않는다.
- `memberSha256`은 JSONL 전체 bytes, `logicalSha256`은 source identity/FK ID로 canonicalize한 logical row bytes(각 row의 LF 포함)를 hash한 값이다. target physical ID와 vault ciphertext는 logical hash domain에 들어가지 않는다. target mapping 뒤에는 별도로 physical row hash를 계산하며 source logical hash와 혼동하지 않는다. row count, source PK set, logical hash, member hash는 import 후 재계산해 모두 일치해야 한다.

### 3.2 첨부 content addressing

첨부 object 이름은 원본 byte 전체를 SHA-256한 lowercase hex뿐이다(`attachments/<sha256>`). manifest의 `bytes`, `contentType`, member/hash는 실제 member와 일치해야 한다. 동일 byte는 한 member로 deduplicate하며 row attachment reference는 위 manifest `attachmentRefs` descriptor에 의해 그 sha256을 사용한다. 참조가 없는 첨부 또는 member가 가리키지 않는 attachment descriptor, dangling row reference, hash/size/content-type 불일치는 `ATTACHMENT_INVALID`다. 첨부는 변환·재압축·줄바꿈·metadata 삽입 없이 보존한다. target encrypted object 검증은 randomized ciphertext bytes가 아니라 복호화한 plaintext bytes의 SHA-256과 content length를 source attachment hash/bytes와 비교한다.

## 4. export snapshot, PII 재암호화와 import 경계

CCCX에는 source key, target key, provider key, password, DPAPI blob, JWT, signed URL이 들어가지 않는다. Cloud export adapter는 Postgres의 consistent read transaction snapshot과 institution-owned private Storage의 immutable attachment pin을 함께 확보한다. Local export adapter도 encrypted SQLite snapshot과 immutable file pin을 확보한다. 이후 모든 adapter는 두 pass로 수행한다. 1차 pass는 snapshot/pin을 streaming으로 읽어 row/member hash·count·size·schema/manifest digest를 계산하고, 2차 pass는 같은 snapshot/pin을 다시 읽어 manifest-first ZIP을 만든다. 재조회가 불가능한 adapter는 encrypted spool만 사용할 수 있으며 plaintext ZIP/row/attachment temporary file은 만들지 않는다. 최종 `.cccx`도 encrypted temp에 쓰고 fsync 후 atomic replace한다.

- table column metadata가 `pii=true`인 값은 authenticated plaintext payload 안에서만 logical value로 존재한다. PII 값은 journal·progress·error에 복사하지 않는다.
- importer는 target `SecretStore`에서 `PII_ENC_KEY`와 `PII_KEY_VERSION`을 읽고 S9가 정한 target vault envelope로 각 PII 값을 메모리에서 즉시 재암호화한다. source PII key를 요구하거나 export하지 않으며 target key가 없으면 `TARGET_KEY_UNAVAILABLE`로 중단한다.
- import 후 re-export의 source logical row hash, table member hash, attachment plaintext SHA/bytes는 source와 같아야 한다. target physical row hash·identity mapping·vault ciphertext/nonce는 별도 값이며 target ciphertext bytes를 비교하지 않는다.
- manifest/data의 `secret=true` field 또는 금지된 secret/session/provider credential은 `FORBIDDEN_SECRET_DATA`다. importer는 비밀을 추측해 마스킹하지 않고 거부한다.

Import target은 **비어 있는 isolated shadow namespace**여야 한다. 기존 active namespace를 직접 mutate하거나 populated shadow namespace에 merge하지 않는다. import namespace는 normal application query, normal audit, user-visible trigger의 대상이 아니며 pending row를 visible query로 읽거나 일반 audit event/trigger를 발생시키면 안 된다.

- stable identity remap input은 `{sourceStableId,targetStableId}` 쌍의 unique list다. imported source identity set에서 target mapping은 injective이고, 그 imported set에 대해서는 bijective여야 한다. target은 `(importId, sourceStableId) -> targetStableId`와 역방향 `(importId, targetStableId) -> sourceStableId`를 shadow namespace에 unique constraint로 persist한다. auth provider ID, SID, session ID는 복사하지 않는다. mapping이 없거나 둘 이상의 target을 가리키면 `IDENTITY_MAPPING_REQUIRED`다.
- 각 foreign key는 source PK→target PK mapping을 만들고 모든 참조가 shadow namespace에서 resolve되는지 먼저 확인한다. dangling/ambiguous mapping은 `REFERENCE_MAPPING_INVALID`다. importer가 임의 ID를 생성하거나 행을 버리지 않는다. logical hash는 source ID로 canonicalize해 계산하고 target physical hash는 별도 검증한다.

## 5. staging, durable journal와 atomic visibility

`importId`는 import 시작 때 CSPRNG로 만든 외부 random UUID이며 payload hash나 package name에서 derive하지 않는다. 같은 payload라도 시도마다 새 importId를 쓴다. payload/row hash는 integrity/provenance fields로만 사용하고 importId·로그·경로에 stable fingerprint로 쓰지 않는다.

Journal은 flat plaintext file이 아니라 target DB의 durable journal namespace에 저장한다. 각 frame은 다음과 같고 DB commit이 durability 경계다.

```
frameVersion[1] || sequence[8] || bodyLength[4] || bodyJcs[bodyLength] || bodySha256[32]
```

`bodyJcs`에는 random importId, phase, operation, member path, expected hash/size, row/file count, target namespace, per-file source-member→target-path provenance와 timestamp만 넣는다. row body, PII, key, password, URL과 payload fingerprint는 넣지 않는다. frame sequence는 단조 증가하고 checksum 불일치·gap·중복은 `RECOVERY_BLOCKED`다. process-exclusive lock은 DB durable lease와 fencing token을 사용해 Cloud를 포함한 모든 process에서 하나만 side effect를 수행하게 한다.

Journal phase는 `created → validated → staged → db_prepared → files_promoted → committed → complete`이며 실패 시 `aborted`를 기록한다. **journal과 lock은 shadow namespace 또는 staging보다 먼저 존재해야 하고, target key는 첫 dependent staging보다 먼저 획득해야 한다.** 다음 순서를 지킨다.

1. process lock과 DB durable lease/fencing token을 확보한다. shadow namespace·stage·final object를 만들기 전에 `created` frame을 atomic DB batch로 먼저 commit한다.
2. target `PII_ENC_KEY`, `PII_KEY_VERSION`, `FILE_ENC_KEY`를 SecretStore에서 획득하고 key-ready frame을 durable하게 기록한다. header, GCM, inner digest, exact ZIP geometry, manifest bijection, schema/migration digest, identity/FK mapping과 all row/file hashes를 검증한 뒤에만 `validated`를 commit한다.
3. empty shadow namespace와 encrypted-only staging을 만든다. 모든 stage path는 nofollow 검사, exclusive create, private permission을 사용한다. plaintext ZIP/PII를 disk에 쓰지 않는다. 매 파일은 source member hash, target encrypted object hash, byte count, target path provenance를 journal에 기록하며 local parent directory는 file fsync 뒤 fsync한다.
4. target PII key로 변환한 rows와 shadow namespace import marker를 한 atomic `Database.batch()`로 기록한다. marker/rows는 `pending` visibility이고 normal query/audit/trigger에 노출되지 않는다. batch 실패는 전부 rollback한다.
5. Local filesystem은 encrypted stage file을 nofollow+exclusive 방식으로 final content-addressed path에 atomic `rename`한다. 기존 파일은 복호화한 plaintext hash/size가 같을 때만 재사용한다. Cloud adapter는 institution-owned private storage에 conditional put(`If-None-Match: *`)과 expected plaintext SHA/size metadata를 사용한다. Cloud export/import 양방향 모두 각각 Postgres/Storage adapter를 통해 immutable snapshot/pin 또는 conditional private put을 수행한다. partial/unreferenced encrypted object는 visible pointer에서 도달할 수 없다.
6. 모든 shadow row/file hash와 final object plaintext hash/presence를 재검증한 뒤, **pointer, complete marker, manifest hash, imported source/target mapping metadata와 `committed`/`complete` 상태를 하나의 atomic DB batch에 함께 쓴다.** 이 transaction이 irreversible commit point다. 이 transaction 전에는 active pointer가 바뀌지 않고 normal write/query가 새 namespace를 보지 않는다. transaction commit 후 journal `complete` frame을 durable하게 남긴다. DB commit 직후 process가 죽어도 complete marker와 pointer가 함께 있으므로 normal query에 partial state가 노출되지 않는다.

## 6. crash recovery와 실패 규칙

재기동 시 process-exclusive DB lease/fencing token을 확보하고 frame checksum/sequence, DB pending marker, shadow rows, final files/objects를 전부 검사한다. **complete marker·manifest hash·active pointer가 있는 경우에는 mutable active row/file hash를 다시 검사하거나 rollback하지 않는다.** 그것은 이후의 정상 write가 반영된 상태일 수 있다. journal에 final frame이 없으면 DB complete marker에서 `complete` frame만 append/finalize한다. 그 밖의 상태는 immutable shadow/staged content의 hash/provenance를 검사해 resume 또는 rollback하며 원본 active namespace를 직접 변경하지 않는다.

| 장애 지점 | 재시작 동작 | 허용 최종 상태 |
|---|---|---|
| decrypt/validate 전 또는 staging fsync 실패 | side effect 전 journal이면 shadow/stage를 만들지 않거나 제거하고 `aborted` | 원본만 유지 |
| encrypted stage write, path nofollow/exclusive, parent fsync, DB batch 실패 | failed batch rollback, encrypted orphan 제거/quarantine 후 shadow 삭제 | 원본만 유지 |
| `db_prepared` 뒤 crash | pending rows는 숨긴 채 journal provenance 및 shadow/final plaintext hashes를 확인. 모두 맞으면 promote를 resume하고 pointer+complete batch, 아니면 pending namespace rollback | 원본만 유지 또는 완전 적용 |
| 일부 local rename 또는 Cloud conditional put 뒤 crash | 각 destination plaintext hash/conditional provenance를 확인해 누락만 재개. 충돌/불일치면 새 encrypted object와 shadow를 제거하고 pointer를 바꾸지 않음 | 원본만 유지 또는 완전 적용 |
| pointer+complete transaction 뒤 journal frame 전 crash | DB의 pointer, complete marker, manifest hash가 있으면 mutable active state를 재검증하거나 rollback하지 않고 `complete` frame만 보강한다. complete marker가 없으면 immutable shadow/staged hash를 검증해 pointer+complete batch를 재개하거나 shadow를 폐기한다 | 원본만 유지 또는 완전 적용
| disk full, permission, fsync/rename/put 오류 | 성공 보고 금지. durable journal에 retry/rollback state를 남기고 visibility pointer를 바꾸지 않음 | 원본만 유지 또는 완전 적용 |

DB/파일 storage 간 OS-level atomicity를 가장하지 않는다. immutable shadow namespace, single visibility pointer+complete marker transaction, durable journal, per-file provenance가 함께 같은 visible invariant를 보장한다. journal 또는 cleanup 손상으로 plaintext 부재를 증명할 수 없으면 `RECOVERY_BLOCKED`로 중지한다. encrypted orphan quarantine는 허용하지만 plaintext residue는 0이어야 하며, plaintext가 발견되면 import 성공을 금지하고 안전한 운영 복구를 요구한다.

완료 전 `rowCount`, source PK set, source logical row hash, member hash, attachment plaintext SHA/size가 하나라도 다르면 `ROW_LOSS_DETECTED`로 shadow/pending state를 rollback한다. pointer+complete+manifest hash transaction은 irreversible commit point이고 그 전까지 모든 import hash는 immutable shadow/staged content와 대조한다. complete marker를 본 recovery는 mutable active rows/files의 이후 hash 차이를 정상 write로 간주해 rollback하지 않는다. 같은 payload의 재시도는 exact active state(전체 row/file/manifest hash와 pointer 일치)인 경우에만 no-op이다. active state가 diverged/deleted/corrupt하면 `IMPORT_CONFLICT`로 partial merge하지 않고 package에서 fresh empty shadow를 다시 만들어 atomic cutover하며 explicit repair audit를 남긴다.

오류 code는 `INVALID_HEADER`, `UNSUPPORTED_FORMAT`, `PASSPHRASE_TOO_SHORT`, `DECRYPTION_FAILED`, `INVALID_ZIP`, `ZIP_LIMIT_EXCEEDED`, `MANIFEST_INCOMPLETE`, `SCHEMA_INCOMPATIBLE`, `ATTACHMENT_INVALID`, `TARGET_KEY_UNAVAILABLE`, `FORBIDDEN_SECRET_DATA`, `IDENTITY_MAPPING_REQUIRED`, `REFERENCE_MAPPING_INVALID`, `ROW_LOSS_DETECTED`, `IMPORT_CONFLICT`, `RECOVERY_BLOCKED`로 고정한다. 오류 응답·운영 log에는 random importId, code, phase, timestamp만 남긴다. hash, payload name, password, key, PII, row body, URL을 log에 남기지 않는다.

## 7. 세 모드와 방향

| source → target | 저장/commit sequence | 계약 |
|---|---|---|
| Community Cloud → Local Single | Cloud Postgres/Storage adapter snapshot read → encrypted local shadow → local atomic rename → pointer+complete | 지원. Cloud signed URL/session/secret은 제외하고 durable data·첨부만 이동 |
| Local Single → Community Cloud | encrypted local snapshot → Cloud Postgres/Storage adapter journal + conditional private puts → pointer+complete | 지원하며 첫 구현 우선 방향 |
| Community Cloud → Local Office | Cloud Postgres/Storage adapter snapshot read → Office encrypted shadow → server pointer+complete | 지원. target Office의 DPAPI/CA/FILE key로 재암호화 |
| Local Office → Community Cloud | Office encrypted snapshot → Cloud Postgres/Storage adapter journal + conditional private puts → pointer+complete | 지원 |
| Local Single ↔ Local Office | local encrypted snapshot → target shadow/atomic rename → pointer+complete | 양방향 지원하며 첫 구현 우선 방향 |
| 같은 mode → 같은 mode | isolated shadow → full revalidation → pointer+complete | 지원하는 backup/restore. 같은 payload 재적용은 full revalidation 뒤에만 no-op |

포맷은 여섯 cross-mode 방향을 모두 정의한다. sourceMode와 target mode가 다르다는 이유로 거부하지 않지만 target schema digest, migration parity, SecretStore, file encryption, identity/FK mapping, 권한·TLS 경계를 target이 소유한다. 설치 키·사용자 계정·기관 식별자는 package에서 복사하지 않고 명시적 target mapping을 사용한다. 현재 보류한 모드나 provider로 우회하지 않으며 unsupported schema는 명시적으로 실패한다.

## 8. 완료 조건

- [ ] magic/framing, 1..4096 header bound, canonical JCS golden bytes/AAD, Argon2id v1.3 parameters와 AES-256-GCM tag 규칙이 고정되어 있다.
- [ ] inner authenticated payload digest가 ciphertext 안에 있고, random importId와 no stable fingerprint/log 규칙이 고정되어 있다.
- [ ] deterministic ZIP의 manifest-first/raw UTF-8 comparator, local/central fixed fields, exact EOCD/non-overlap/no ZIP64, zero-byte member, 65,535 member cap과 descriptor bijection이 고정되어 있다.
- [ ] manifest의 exact schemaDigest input, ordered migrationSet, canonical SQL tagged types, JSONL ordering, source logical/target physical row hash, explicit foreignKey/attachmentRef descriptor와 attachment plaintext verification이 고정되어 있다.
- [ ] PII 값은 target `PII_ENC_KEY`/`PII_KEY_VERSION`으로만 재암호화되고 어떤 key도 package·journal·log에 export되지 않는다.
- [ ] consistent snapshot/immutable pins, empty shadow namespace, injective+bijection identity map with persisted reverse map, explicit FK mapping, encrypted-only stage, checksummed DB-backed framed journal, durable lease/fencing, nofollow/parent durability, local/cloud adapter sequence, pointer+complete+manifest hash atomic transaction이 고정되어 있다.
- [ ] wrong password/auth tamper, schema incompatibility, reference/row loss, partial disk/storage failure의 code·판정·복구가 문서에 완결되어 있다.
- [ ] 세 모드의 여섯 방향과 Cloud 양방향 adapter 및 Single→Office/Cloud 우선 구현 관계가 문서에 완결되어 있다.
- [ ] 아래 fixture와 명령의 입력·기대 판정이 §9에 정의되어 있다.

## 9. 검증 방법

구현 검증 시 저장소 루트에서 다음 명령을 실행한다.

- `pnpm test:contracts --cccx=golden`: fixed golden header bytes와 zero-row/zero-byte attachment를 포함한 동일 logical fixture를 두 번 export한다. 기대: ZIP member bytes/order/manifest/schema/table/attachment logical hashes가 같고 random salt/nonce·outer ciphertext·random importId만 달라진다.
- `pnpm test:contracts --cccx=crypto`: 16자 passphrase 성공, 15자 거부, wrong password, header/tag/inner digest bit flip, non-canonical/base64url/hex case를 확인한다. 기대: `PASSPHRASE_TOO_SHORT`, `INVALID_HEADER`, 또는 `DECRYPTION_FAILED`와 DB/file 변경 0건.
- `pnpm test:contracts --cccx=zip`: duplicate/unlisted descriptor, local-central common-field mismatch, invalid local/central fixed field, bad offset/overlap, trailing EOCD, ZIP64/data descriptor, path traversal, zero-byte member and cap overflow fixture를 확인한다. 기대: staging·DB·visibility pointer 변경 전에 고정 code로 거부.
- `pnpm test:contracts --cccx=compatibility`: exact schemaDigest/migration set 일치, 낮은/높은 version, unknown table/column/type, tagged-type 오류, duplicate PK, exclusion 누락, identity map non-injective/non-bijective, FK dangling/ambiguous fixture를 확인한다. 기대: `SCHEMA_INCOMPATIBLE`, `MANIFEST_INCOMPLETE`, `IDENTITY_MAPPING_REQUIRED`, `REFERENCE_MAPPING_INVALID` 중 하나로 거부하고 silent drop 0건.
- `pnpm test:contracts --cccx=crash`: journal/lock/key acquisition 직전·후, shadow creation, stage fsync, DB batch, local rename, Cloud conditional put, pointer+complete transaction 뒤 process kill, disk-full/permission simulation을 실행한다. 기대: 재시작 뒤 original unchanged 또는 verified complete뿐이고 pending visible rows, partial pointer, normal audit/trigger exposure, plaintext residue가 0건.
- `pnpm test:contracts --cccx=roundtrip`: Cloud↔Single, Cloud↔Office, Single↔Office 여섯 방향을 synthetic fixture와 explicit identity/FK mapping으로 왕복한다. 기대: source logical row hash, table member hash, attachment plaintext SHA/bytes, row count가 deterministic하게 일치하고 target physical/vault ciphertext는 별도로 검증되며 달라도 된다.
- `pnpm guard:cccx`: 허용되지 않은 member/path/ZIP metadata, secret export, plaintext spool/stage, stable payload fingerprint/import ID, local/cloud visibility 전에 complete marker 누락을 정적으로 거부한다.

각 명령은 기존 assertion 삭제·skip·완화, partial import 성공 보고, silent row drop, plaintext residue, key/URL/PII/hash log, normal query/audit/trigger 노출이 하나라도 있으면 실패다. 실제 adapter·파일·복원 결과는 E3-7 구현 검증에서만 이 상태를 `구현 검증 완료`로 올릴 수 있다.

## 10. 이번에 안 하는 것

CCCX v2, 압축 codec 추가, ZIP64, streaming ZIP 재개, schema 자동 migration, source key export, provider credential portability, OS 간 DPAPI 변환, signed package distribution은 이 계약에 넣지 않는다. 설치기 서명·manifest·update/rollback은 SG12가, Recovery Kit의 key wrapping·cross-SID 복원은 SG9가, 원음 보관·삭제 증거는 SG8이 소유하며 이 문서에서 정의를 복제하지 않는다.
