# v4.5.2 개별 배지 이미지

같은 원본 일러스트에서 배지 6종을 각각 220×220 투명 WebP로 압축했습니다. 한눈에 보기에서는 선택한 배지만 불러옵니다. 설치 아이콘과 앱의 테마 아이콘은 v4.5.1 파일을 유지했습니다.

# v4.5.1 앱 이미지 최적화

기존 앱 내 테마 PNG 세 장을 화면에 표시하는 크기에 맞춰 144×144 무손실 WebP로 바꿨습니다. 테마와 그림 자체는 이전과 같으며, 출처에 대한 검토 상태도 바뀌지 않았습니다. Android의 빨간색 설치 아이콘에는 기존 PNG를 그대로 사용합니다. 배지의 색상과 6개 배치를 유지하고 660×440 투명 WebP로 줄였습니다.

# v4.5.0 헌혈 달성 배지

사용자가 제공한 여섯 가지 헌혈 달성 배지 예시를 참고해 각각의 색과 모티프를 살린 앱용 일러스트를 제작했습니다. 공식 상훈 이미지를 포함하지 않습니다. `assets/milestones.webp`는 투명한 WebP 한 장으로 묶은 768×512 배지 이미지입니다. 앱에는 최종 이미지 한 장만 들어가며, 외부에서 불러오지 않습니다.

# v3.2.6 사용 범위 변경

홈 화면의 기본 아이콘은 빨강으로 고정합니다. Android `res/drawable-nodpi/`에는 `brand_blood.png`만 남기고 파스텔/초록 native 복사본과 전환용 리소스는 삭제했습니다. 앱 내부 표시용 `assets/brand-blood.png`, `assets/brand-pastel.png`, `assets/brand-initial.png`는 변경하지 않았습니다. 아래 내용은 v3.2.4에 이미지를 준비한 당시의 출처·편집 이력이며, 원본 권리의 확인 상태도 그대로입니다.

# 테마 아이콘 제작 출처

2026-10-24 · v3.2.4

## 원본과 처리 방법

- 사용자 첨부 `image(20261024-080316).png`: 빨강 아이콘 참고.
- 사용자 첨부 `image(20261024-080503).png`: 왼쪽 파스텔/오른쪽 초록 아이콘 참고.
- 내장 image_gen 편집 기능(built-in tool mode), background-extraction, transparent_background=true. CLI/API 키나 외부 파일 전송 스크립트를 사용하지 않았습니다.
- 아이콘별로 한 번씩 편집해 배경·비교용 글자·그림자·장식을 제외하도록 요청했습니다. 결과는 생성형 편집본이므로 원본과 픽셀 단위로 동일하다는 뜻은 아닙니다. 호스트 Pillow로 배포용 256×256 RGBA PNG 크기 조정/PNG 압축만 수행했습니다.
- 고해상도 중간 결과와 사용자 원본은 APK/공개/개인 소스에 포함하지 않습니다. 최종 PNG만 `assets/`와 Android `res/drawable-nodpi/`에 포함합니다. APK 빌드에 이미지 편집 도구나 Pillow는 필요하지 않습니다.

## 저작권 확인 상태

참고 이미지의 원 제작자·원본 라이선스·재배포 권리는 제공되지 않아 **확인 필요**입니다. 본 문서는 제작 경로 기록이며, 제3자의 권리나 재배포 허락을 보장하지 않습니다. 공휴일 MIT 라이선스는 이 이미지에 적용되지 않습니다. 기존 자체 코드의 설정/새로고침 벡터, 시스템 글꼴과 구분합니다.

## 최종 파일

| 테마 | 경로 | 크기 | SHA-256 |
| --- | --- | --- | --- |
| blood | `assets/brand-blood.png` | 56,936 B | `66f89997aad9f17347b153d089bf636fd2fbd65d395862f7472618f1db0038fe` |
| pastel | `assets/brand-pastel.png` | 59,778 B | `384d0eec1c3b07bf7d8f26caf4b0ac95b0dc6f7b79e7a0038e694c3cc437bb60` |
| initial | `assets/brand-initial.png` | 52,877 B | `7ad2d20b60bc42d276bf70148e399096018624780f49d831c6c02a656ecd1b17` |

## 사용한 편집 프롬프트

### blood

```text
Use case: background-extraction. Asset type: production Android launcher icon and app header logo. Edit target: the single RED rounded-square app tile in the provided image. Extract that exact tile onto a genuinely transparent square canvas. Keep the original tile's shape, color palette, glossy softly beveled 3D material, lighting, cream droplet, and the four arithmetic symbols exactly: plus at upper left, minus at upper right, multiplication at lower left, division at lower right. Change only the framing/background: remove surrounding beige backdrop, floor cast shadow, sparkle, comparison headings and all explanatory text. Preserve the artwork within the tile; do not redesign it. One tile only, straight-on, centered, horizontal and vertical alignment, entire rounded square visible with a small consistent transparent margin (tile occupies approximately 90% of canvas width/height). No typography, no additional objects, no checkerboard drawn into the output. Transparent alpha outside the tile, preserve smooth rounded edges. Deliver a single clean square transparent icon.
```

### pastel

```text
Use case: background-extraction. Asset type: production Android launcher icon and app header logo. Edit target: ONLY the LEFT PASTEL pink/lilac rounded-square app tile; exclude the right green tile in the provided image. Extract that exact tile onto a genuinely transparent square canvas. Keep the original tile's shape, color palette, glossy softly beveled 3D material, lighting, cream droplet, and the four arithmetic symbols exactly: plus at upper left, minus at upper right, multiplication at lower left, division at lower right. Change only the framing/background: remove surrounding beige backdrop, floor cast shadow, sparkle, comparison headings and all explanatory text. Preserve the artwork within the tile; do not redesign it. One tile only, straight-on, centered, horizontal and vertical alignment, entire rounded square visible with a small consistent transparent margin (tile occupies approximately 90% of canvas width/height). No typography, no additional objects, no checkerboard drawn into the output. Transparent alpha outside the tile, preserve smooth rounded edges. Deliver a single clean square transparent icon.
```

### initial

```text
Use case: background-extraction. Asset type: production Android launcher icon and app header logo. Edit target: ONLY the RIGHT GREEN rounded-square app tile; exclude the left pastel tile in the provided image. Extract that exact tile onto a genuinely transparent square canvas. Keep the original tile's shape, color palette, glossy softly beveled 3D material, lighting, cream droplet, and the four arithmetic symbols exactly: plus at upper left, minus at upper right, multiplication at lower left, division at lower right. Change only the framing/background: remove surrounding beige backdrop, floor cast shadow, sparkle, comparison headings and all explanatory text. Preserve the artwork within the tile; do not redesign it. One tile only, straight-on, centered, horizontal and vertical alignment, entire rounded square visible with a small consistent transparent margin (tile occupies approximately 90% of canvas width/height). No typography, no additional objects, no checkerboard drawn into the output. Transparent alpha outside the tile, preserve smooth rounded edges. Deliver a single clean square transparent icon.
```

