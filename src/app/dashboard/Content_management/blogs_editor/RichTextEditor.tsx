"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Extension } from "@tiptap/core";
import { useState } from "react";

const FontSize = Extension.create({
  name: "fontSize",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => (element as HTMLElement).style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }: any) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }: any) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export default function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [fontSize, setFontSizeState] = useState<string>("16px");

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-[240px] p-3 outline-none",
      },
    },
  });

  const isActive = (name: string, attrs?: Record<string, any>) => {
    if (!editor) return false;
    return editor.isActive(name as any, attrs as any);
  };

  const btn = (active: boolean) =>
    `px-2 py-1 border rounded text-sm ${
      active ? "bg-gray-200" : "bg-white hover:bg-gray-50"
    }`;

  const setFontSize = (px: string) => {
    setFontSizeState(px);
    editor?.chain().focus().setFontSize(px).run();
  };

  return (
    <div className="border rounded-lg bg-white text-black">
      <div className="flex flex-wrap items-center gap-2 p-2 border-b bg-gray-50">
        <select
          className="px-2 py-1 border rounded text-sm bg-white"
          disabled={!editor}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          title="Text size"
        >
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
          <option value="28px">28</option>
          <option value="32px">32</option>
        </select>

        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={btn(isActive("bold"))}
        >
          Bold
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={btn(isActive("italic"))}
        >
          Italic
        </button>

        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
          className={btn(!!editor && editor.isActive({ textAlign: "left" }))}
          title="Align left"
        >
          Left
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          className={btn(!!editor && editor.isActive({ textAlign: "center" }))}
          title="Align center"
        >
          Center
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          className={btn(!!editor && editor.isActive({ textAlign: "right" }))}
          title="Align right"
        >
          Right
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={btn(isActive("bulletList"))}
        >
          • List
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className={btn(isActive("orderedList"))}
        >
          1. List
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          className={btn(isActive("blockquote"))}
        >
          Quote
        </button>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          className={btn(false)}
        >
          Divider
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
