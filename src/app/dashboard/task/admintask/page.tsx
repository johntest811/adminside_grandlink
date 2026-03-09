import { redirect } from "next/navigation";

export default async function AdminTaskRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") next.append(key, entry);
      }
      continue;
    }
    if (typeof value === "string") next.set(key, value);
  }

  const query = next.toString();
  redirect(`/dashboard/task/employeetask${query ? `?${query}` : ""}`);
}
