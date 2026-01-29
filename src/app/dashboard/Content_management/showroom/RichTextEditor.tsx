"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";

export default function RichTextEditor({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[120px] p-2",
        placeholder: "Enter description here...",
      },
    },
  });

  return (
    <div className="border rounded p-2 bg-white text-black">
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className="px-2 py-1 border rounded text-black"
        >
          • List
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className="px-2 py-1 border rounded text-black"
        >
          1. List
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className="px-2 py-1 border rounded text-black"
        >
          B
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className="px-2 py-1 border rounded text-black"
        >
          I
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}