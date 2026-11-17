/** Public imagery follows the deployment prefix, including GitHub project Pages. */
export const publicAsset = (path: string) =>
  `${import.meta.env.BASE_URL}assets/${path}`;
