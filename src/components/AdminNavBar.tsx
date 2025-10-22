import Image from "next/image";

export default function AdminNavBar() {
  return (
    <header className="w-full bg-white flex items-center px-6 py-2 border-b border-gray-300 shadow-sm">
      <div className="flex items-center gap-3 mb-3 mt-3">
        <Image
          src="/logo.svg"
          alt="Grand East Logo"
          width={170}
          height={170}
          className="object-contain"
        />
      </div>
    </header>
  );
}