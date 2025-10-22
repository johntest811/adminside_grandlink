"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../Clients/Supabase/SupabaseClients"; // <-- Use shared client

type ContentRow = {
  id: string;
  title: string;
  description: string;
  phone?: string | null;
  email?: string | null;
  facebook?: string | null;
  updated_at: string;
};

export default function InquireContentEditor() {
  const [content, setContent] = useState<ContentRow | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [facebook, setFacebook] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("inqruire_content")
          .select("*")
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (!mounted) return;

        if (data) {
          setContent(data);
          setTitle(data.title);
          setDescription(data.description);
          setPhone(data.phone ?? "");
          setEmail(data.email ?? "");
          setFacebook(data.facebook ?? "");
        } else {
          setContent(null);
          setTitle("Inquire Now");
          setDescription("We’re happy to help you bring your vision to life. Kindly provide us with your requirements and contact information below. Our team will get back to you as soon as possible.");
          setPhone("0927‑574‑9475");
          setEmail("grand‑east@gmail.com");
          setFacebook("facebook.com/grandeast");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("load inquire content", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    if (!title.trim() || !description.trim()) {
      alert("Title and description are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        facebook: facebook.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (content?.id) {
        const { error } = await supabase
          .from("inqruire_content")
          .update(payload)
          .eq("id", content.id);
        if (error) throw error;
        alert("Content updated.");
      } else {
        const { data, error } = await supabase
          .from("inqruire_content")
          .insert([payload])
          .select()
          .maybeSingle();
        if (error) throw error;
        setContent(data ?? null);
        alert("Content created.");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("save inquire content", err);
      alert("Could not save content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-black">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black">Inquire Page Editor</h1>
        <div>
          <Link href="/dashboard/inquiries" className="px-3 py-1 rounded bg-gray-100 text-black">Back to Inquiries</Link>
        </div>
      </header>

      <div className="bg-white p-6 rounded shadow">
        {loading ? (
          <div className="text-black">Loading…</div>
        ) : (
          <>
            <label className="block mb-2 text-black font-medium">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 text-black"
              placeholder="Inquire page title"
            />

            <label className="block mb-2 text-black font-medium">Side description (left column)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full border rounded px-3 py-2 mb-4 text-black"
              placeholder="Description shown on the left side of the Inquire page"
            />

            <label className="block mb-2 text-black font-medium">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-3 py-2 mb-3 text-black" placeholder="Phone" />

            <label className="block mb-2 text-black font-medium">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded px-3 py-2 mb-3 text-black" placeholder="Email" />

            <label className="block mb-2 text-black font-medium">Facebook</label>
            <input value={facebook} onChange={(e) => setFacebook(e.target.value)} className="w-full border rounded px-3 py-2 mb-4 text-black" placeholder="Facebook URL or handle" />

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>

              <button
                onClick={() => {
                  if (!content) {
                    setTitle("Inquire Now");
                    setDescription("We’re happy to help you bring your vision to life. Kindly provide us with your requirements and contact information below. Our team will get back to you as soon as possible.");
                    setPhone("0927‑574‑9475");
                    setEmail("grand‑east@gmail.com");
                    setFacebook("facebook.com/grandeast");
                  } else {
                    setTitle(content.title);
                    setDescription(content.description);
                    setPhone(content.phone ?? "");
                    setEmail(content.email ?? "");
                    setFacebook(content.facebook ?? "");
                  }
                }}
                className="px-4 py-2 bg-gray-200 text-black rounded"
              >
                Reset
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}