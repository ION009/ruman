declare module "heatmap.js" {
  type HeatPoint = {
    x: number;
    y: number;
    value: number;
  };

  type HeatmapInstance = {
    setData: (payload: { max: number; data: HeatPoint[] }) => void;
  };

  const heatmap: {
    create: (config: {
      container: HTMLElement;
      radius?: number;
      maxOpacity?: number;
      minOpacity?: number;
      blur?: number;
      gradient?: Record<string, string>;
    }) => HeatmapInstance;
  };

  export default heatmap;
}
