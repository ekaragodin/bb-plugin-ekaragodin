/** Only return credential-free web links to a GitHub repository root. */
export function githubRepositoryUrl(remote: string | null): string | null {
  if (!remote) return null;
  const value = remote.trim();
  const scp = /^git@github\.com:([^\s]+)$/i.exec(value);
  let path: string;
  if (scp) {
    path = scp[1];
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== "github.com"
      || !["https:", "http:", "ssh:", "git:"].includes(url.protocol)
      || url.port || url.search || url.hash) return null;
    path = url.pathname.slice(1);
  }
  path = path.replace(/\/$/, "").replace(/\.git$/, "");
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(path)) return null;
  const repo = path.split("/")[1];
  if (repo === "." || repo === "..") return null;
  return `https://github.com/${path}`;
}
