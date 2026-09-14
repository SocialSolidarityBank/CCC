import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode };

export default function Link({ href, children, ...rest }: Props) {
  return <a href={href} {...rest}>{children}</a>;
}
