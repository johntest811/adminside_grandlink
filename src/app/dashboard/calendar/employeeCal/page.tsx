"use client";

import React, { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchEvents = async () => {
      const { data, error } = await supabase.from("calendar_events").select("*");
      if (error) console.error("Error loading events:", error);
      else setEvents(data || []);
    };
    fetchEvents();
  }, []);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const hay = `${e.title ?? ""} ${e.description ?? ""} ${e.location ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [events, searchQuery]);

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
        className="flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-medium cursor-pointer hover:bg-indigo-100 truncate"
      >
        <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
        <span className="truncate">{eventInfo.event.title}</span>
      </div>
    );
  };

  return (
    <div className="relative p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Company Calendar</h1>
        <p className="text-sm text-gray-600">View upcoming events and schedules.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Events</CardTitle>
          <CardDescription>Filter by title, description, or location.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events…"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setSearchQuery("")}
              disabled={!searchQuery.trim()}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>
            {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            events={filteredEvents}
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
        </CardContent>
      </Card>

      {/* Floating Info Card */}
      {selectedEvent && popupPosition && (
        <div
          className="absolute bg-white rounded-lg shadow-lg p-4 w-72 border border-gray-200 z-50"
          style={{ top: popupPosition.y - 50, left: popupPosition.x + 20 }}
        >
          <h2 className="text-lg font-semibold text-gray-900">{selectedEvent.title}</h2>
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
            <Button type="button" onClick={() => setSelectedEvent(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
