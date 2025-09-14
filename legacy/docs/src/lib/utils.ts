export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_WWW_URL}${path}`;
}
