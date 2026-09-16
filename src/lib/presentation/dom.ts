export const el = <T extends HTMLElement = HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing simulator element: ' + id);
  return element as T;
};
