export interface ModelCredit {
  title: string;
  author: string;
  authorUrl: string;
  url: string;
  license: string;
  licenseUrl: string;
}

const cache = new Map<string, Promise<Record<string, ModelCredit>>>();

function credits(file: string): Promise<Record<string, ModelCredit>> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}${file}`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    cache.set(file, p);
  }
  return p;
}

/** Attribution for a loaded vehicle source, shown under the car name. */
export async function creditFor(source: string): Promise<ModelCredit | null> {
  const sketchfab = /\/sketchfab\/([\w-]+)\.glb$/.exec(source);
  if (sketchfab) return (await credits('assets/vehicles/sketchfab/credits.json'))[sketchfab[1]] ?? null;
  const local = /\/vehicles\/((?:garage|traffic)\/[\w-]+)\.glb$/.exec(source);
  if (local) return (await credits('assets/vehicles/credits.json'))[local[1]] ?? null;
  return null;
}
