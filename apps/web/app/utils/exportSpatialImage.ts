/**
 * Rasterizes a heatmap view (map image + its overlaid `<canvas>`/`<svg>`
 * layers) into a single PNG and triggers a normal browser download --
 * plain `HTMLCanvasElement.toBlob` + an `<a download>` click, no server
 * round-trip.
 */
export async function exportSpatialImageElement(container: HTMLElement, fileName: string): Promise<void> {
  const img = container.querySelector("img");
  const width = img?.naturalWidth || container.clientWidth;
  const height = img?.naturalHeight || container.clientHeight;
  if (!width || !height) return;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return;

  if (img) ctx.drawImage(img, 0, 0, width, height);

  for (const canvas of container.querySelectorAll("canvas")) {
    ctx.drawImage(canvas, 0, 0, width, height);
  }

  for (const svg of container.querySelectorAll("svg")) {
    const svgImage = await rasterizeSvg(svg, width, height);
    ctx.drawImage(svgImage, 0, 0, width, height);
  }

  const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function rasterizeSvg(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const serialized = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.width = width;
    image.height = height;
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    image.src = url;
  });
}
