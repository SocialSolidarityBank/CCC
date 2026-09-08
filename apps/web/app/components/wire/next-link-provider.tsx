'use client';

import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { WireLinkProvider, type WireLinkRenderer } from './wire-button';

// apps/web 전용 링크 어댑터(2026-09-08). 공용 부품은 프레임워크를 모르고 기본값이 평범한
// <a> 라, 클라이언트 사이드 이동이 필요한 이 앱만 자기 렌더러를 끼운다.
//
// 렌더러를 모듈 안 상수로 두는 이유: 서버 컴포넌트인 RootLayout 이 함수를 prop 으로 넘기면
// RSC 직렬화 경계에서 막힌다. 이 파일이 'use client' 라 함수가 클라이언트 번들 안에서
// 만들어지고, 서버는 이 컴포넌트를 렌더하기만 한다.
//
// DOM 은 바뀌지 않는다. WireLinkProps 가 넘기는 속성을 그대로 <a> 로 흘려보내며,
// 클래스·data 속성·아이콘 순서는 공용 부품이 이미 정한 그대로다(디자인 게이트가 이 DOM 을 잰다).
const renderNextLink: WireLinkRenderer = (props) => <NextLink {...props} />;

/** 셸 전체를 감싸는 링크 어댑터. DOM 래퍼를 만들지 않고 컨텍스트만 얹는다. */
export function NextLinkProvider({ children }: { children: ReactNode }) {
  return <WireLinkProvider renderer={renderNextLink}>{children}</WireLinkProvider>;
}
