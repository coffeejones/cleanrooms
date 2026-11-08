export function redirectSystemPath({ path }: { path: string }) {
  // Ignore callbacks from the retired browser bridge, including older app versions.
  const workplacePolicyReturnUrl = 'cleanrooms://gps-return';
  return path === workplacePolicyReturnUrl || path.startsWith(workplacePolicyReturnUrl + '?') ? null : path;
}
