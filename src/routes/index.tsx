import { createFileRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Welcome to Tauri + React</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          className="border px-2 py-1 rounded"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button className="px-4 py-1 bg-blue-600 text-white rounded" type="submit">
          Greet
        </button>
      </form>
      {greetMsg && <p className="mt-4">{greetMsg}</p>}
    </main>
  );
}
