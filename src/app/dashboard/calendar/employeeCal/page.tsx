"use client";

import React, { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";

type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  start: string;
  end?: string;
  location?: string;
};

export default function EmployeeCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      const { data, error } = await supabase.from("calendar_events").select("*");
      if (error) console.error("Error loading events:", error);
      else setEvents(data || []);
    };
    fetchEvents();
  }, []);

  const handleEventClick = (info: any) => {
    setSelectedEvent({
      id: info.event.id,
      title: info.event.title,
      description: info.event.extendedProps.description,
      start: info.event.start?.toISOString() || "",
      end: info.event.end?.toISOString() || "",
      location: info.event.extendedProps.location,
    });

    setPopupPosition({ x: info.jsEvent.pageX, y: info.jsEvent.pageY });
  };

  const renderEventContent = (eventInfo: any) => {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-md bg-red-100 text-red-700 text-xs font-medium cursor-pointer hover:bg-red-200 truncate"
      >
        <span className="w-2 h-2 rounded-full bg-red-600"></span>
        <span className="truncate">{eventInfo.event.title}</span>
      </div>
    );
  };

  return (
    <div className="relative p-6">
      <h1 className="text-2xl font-bold text-red-700 mb-4">📅 Company Calendar</h1>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        events={events}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,listWeek",
        }}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        displayEventEnd={false}
        dayMaxEventRows={4} 
      />

      {/* Floating Info Card */}
      {selectedEvent && popupPosition && (
        <div
          className="absolute bg-white rounded-lg shadow-lg p-4 w-72 border border-gray-200 z-50"
          style={{ top: popupPosition.y - 50, left: popupPosition.x + 20 }}
        >
          <h2 className="text-lg font-bold text-red-700">{selectedEvent.title}</h2>
          <p className="text-black text-sm mb-2">
            {selectedEvent.description || "No description provided."}
          </p>
          <p className="text-xs text-black">
            <strong>📅 Start:</strong>{" "}
            {new Date(selectedEvent.start).toLocaleString()}
          </p>
          {selectedEvent.end && (
            <p className="text-xs text-black">
              <strong>⏳ Due:</strong>{" "}
              {new Date(selectedEvent.end).toLocaleString()}
            </p>
          )}
          {selectedEvent.location && (
            <p className="text-xs text-black">
              <strong>📍 Location:</strong> {selectedEvent.location}
            </p>
          )}
          <div className="flex justify-end mt-3">
            <button
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
              onClick={() => setSelectedEvent(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
