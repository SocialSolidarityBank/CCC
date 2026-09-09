import type { AnchorHTMLAttributes, ReactNode } from '../../apps/web/node_modules/react/index.js';

type PrototypeLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export default function PrototypeLink({ href, children, ...props }: PrototypeLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
