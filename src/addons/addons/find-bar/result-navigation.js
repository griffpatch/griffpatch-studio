// Shared by the search input and structural editors which use Finder results.
// Do not consume ordinary arrows: they belong to text/block navigation there.
export const resultNavigationDirection = event => {
  if (event.defaultPrevented || event.isComposing || event.altKey) return 0;
  const functionKey = event.key === "F3" && !event.ctrlKey && !event.metaKey;
  const findAgain = event.key?.toLowerCase() === "g" && (event.ctrlKey || event.metaKey);
  return functionKey || findAgain ? (event.shiftKey ? -1 : 1) : 0;
};
