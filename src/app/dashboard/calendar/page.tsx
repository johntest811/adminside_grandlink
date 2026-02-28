"use client";
import { supabase } from '../../Clients/Supabase/SupabaseClients';
import { useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  start: string;
  end?: string;
  location?: string;
};

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start: "",
    end: "",
    location: "",
  });

  const toLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };

  const fetchEvents = async () => {
    const { data, error } = await supabase.from("calendar_events").select("*").order("start", { ascending: true });
    if (error) {
      console.error("Error fetching events:", error);
    } else {
      setEvents(data || []);
    }
  };

  // ✅ Load events from Supabase
  useEffect(() => {
    fetchEvents();
  }, []);

  const openCreateModal = () => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    setFormData({
      title: "",
      description: "",
      start: toLocalInput(now),
      end: toLocalInput(oneHourLater),
      location: "",
    });
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

  // ✅ Open modal to create new event
  const handleDateClick = (arg: any) => {
    const clicked = arg?.date instanceof Date ? (arg.date as Date) : new Date();
    const oneHourLater = new Date(clicked.getTime() + 60 * 60 * 1000);
    setFormData({
      title: "",
      description: "",
      start: toLocalInput(clicked),
      end: toLocalInput(oneHourLater),
      location: "",
    });
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

  // ✅ Open modal to edit existing event
  const handleEventClick = (clickInfo: any) => {
    const event = clickInfo.event;
    const startLocal = event.start ? toLocalInput(event.start as Date) : "";
    const endLocal = event.end ? toLocalInput(event.end as Date) : "";
    setSelectedEvent({
      id: event.id,
      title: event.title,
      description: event.extendedProps.description,
      start: event.startStr,
      end: event.endStr,
      location: event.extendedProps.location,
    });
    setFormData({
      title: event.title,
      description: event.extendedProps.description || "",
      start: startLocal,
      end: endLocal,
      location: event.extendedProps.location || "",
    });
    setIsModalOpen(true);
  };

  // ✅ Save event (Create or Update)
  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedEvent) {
      // update existing
      const { error } = await supabase
        .from("calendar_events")
        .update(formData)
        .eq("id", selectedEvent.id);
      if (error) console.error(error);
    } else {
      // create new
      const { error } = await supabase.from("calendar_events").insert([formData]);
      if (error) console.error(error);
    }

    setIsModalOpen(false);
    await fetchEvents();
  };

  // ✅ Delete event
  const handleDeleteEvent = async () => {
    if (selectedEvent) {
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", selectedEvent.id);
      if (error) console.error(error);

      setIsModalOpen(false);
      await fetchEvents();
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEvents = normalizedQuery.length
    ? events.filter((ev) => {
        const haystack = `${ev.title} ${ev.description ?? ""} ${ev.location ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : events;

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl text-red-700">Calendar & Scheduling</CardTitle>
              <CardDescription>
                Create events, view schedules, and manage updates.
              </CardDescription>
            </div>
            <CardAction>
              <Button type="button" onClick={openCreateModal}>
                + Add Event
              </Button>
            </CardAction>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Search events</label>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, description, or location"
              />
              {searchQuery.trim().length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSearchQuery("")}
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredEvents.length} of {events.length} events
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            selectable={true}
            editable={false}
            events={filteredEvents}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,listWeek",
            }}
            dayHeaderClassNames={() => ["!text-black", "!font-bold"]}
            dayCellClassNames={() => ["!text-black"]}
            titleFormat={{ year: "numeric", month: "long" }}
          />
          <style jsx global>{`
            .fc-daygrid-day-number,
            .fc-col-header-cell-cushion,
            .fc-toolbar-title {
              color: black !important;
            }
          `}</style>
        </CardContent>
      </Card>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="w-full max-w-lg px-4">
            <Card className="relative">
              <CardHeader className="border-b">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl text-red-700">
                      {selectedEvent ? "Edit Event" : "Add Event"}
                    </CardTitle>
                    <CardDescription>Fill in the event details below.</CardDescription>
                  </div>
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setIsModalOpen(false)}
                      aria-label="Close"
                    >
                      ✕
                    </Button>
                  </CardAction>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveEvent} className="flex flex-col gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      placeholder="Event title"
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({ ...formData, description: e.target.value })
                      }
                      placeholder="Optional description"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Start</label>
                      <Input
                        type="datetime-local"
                        value={formData.start}
                        onChange={(e) =>
                          setFormData({ ...formData, start: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">End</label>
                      <Input
                        type="datetime-local"
                        value={formData.end}
                        onChange={(e) =>
                          setFormData({ ...formData, end: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Location</label>
                    <Input
                      value={formData.location}
                      onChange={(e) =>
                        setFormData({ ...formData, location: e.target.value })
                      }
                      placeholder="Optional location"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 mt-2">
                    {selectedEvent ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleDeleteEvent}
                      >
                        Delete
                      </Button>
                    ) : (
                      <div />
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsModalOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit">Save Event</Button>
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}