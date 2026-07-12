import { iconUrl, type IconName } from "../three/icons";

interface Props {
  name: IconName | string;
  size?: number;
  className?: string;
  title?: string;
}

/** Render a framed RPG icon by name. Purely decorative (empty alt). */
export function Icon({ name, size = 22, className, title }: Props) {
  return (
    <img
      src={iconUrl(name)}
      width={size}
      height={size}
      className={`icon ${className ?? ""}`}
      alt=""
      title={title}
      draggable={false}
      loading="lazy"
    />
  );
}
