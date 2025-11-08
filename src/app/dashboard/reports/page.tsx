"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement, // NEW
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2"; // NEW: Doughnut

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement // NEW
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SalesData {
  totalSales: number;
  totalProductsSold: number;
  totalOrders: number;
  successfulOrders: number;
  cancelledOrders: number;
  pendingOrders: number;
  averageOrderValue: number;
}

interface ProductData {
  id: string;
  name: string;
  inventory: number;
  reserved_stock: number;
  price: number;
  category: string;
  total_sold: number;
  revenue: number;
}

type DailySeries = {
  labels: string[];
  revenue: number[];
  products: number[];
  successfulOrders: number[];
  aov: number[];
};

export default function ReportsPage() {
  const [salesData, setSalesData] = useState<SalesData>({
    totalSales: 0,
    totalProductsSold: 0,
    totalOrders: 0,
    successfulOrders: 0,
    cancelledOrders: 0,
    pendingOrders: 0,
    averageOrderValue: 0,
  });
  const [productsData, setProductsData] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);

  // Add refs to access the chart instances
  const revenueLineRef = useRef<any>(null);
  const kpiDoughnutRef = useRef<any>(null);        // NEW
  const ordersStatusRef = useRef<any>(null);       // NEW
  const categoryRevenueRef = useRef<any>(null);    // NEW
  const completedOrdersRef = useRef<any>(null);    // NEW for section reference

  // New: daily chart series
  const [dailySeries, setDailySeries] = useState<DailySeries>({
    labels: [],
    revenue: [],
    products: [],
    successfulOrders: [],
    aov: [],
  });

  useEffect(() => {
    loadCurrentAdmin();
  }, []);

  useEffect(() => {
    if (currentAdmin) {
      fetchReportsData();
      // Load completed orders list with details (server API, service role)
      fetchCompleted();
    }
  }, [currentAdmin, dateRange]);

  const loadCurrentAdmin = async () => {
    try {
      const sessionData = localStorage.getItem("adminSession");
      if (sessionData) {
        const admin = JSON.parse(sessionData);
        setCurrentAdmin(admin);
      }
    } catch (e) {
      console.error("Error loading admin session:", e);
    }
  };

  const buildDateKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

  const enumerateDates = (start: string, end: string) => {
    const out: string[] = [];
    const cur = new Date(start + "T00:00:00Z");
    const last = new Date(end + "T23:59:59Z");
    while (cur <= last) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  };

  const fetchReportsData = async () => {
    try {
      setLoading(true);

      // Filter window
      const startISO = `${dateRange.startDate}T00:00:00Z`;
      const endISO = `${dateRange.endDate}T23:59:59Z`;

      // Orders within window
      const { data: ordersData, error: ordersError } = await supabase
        .from("user_items")
        .select(
          `
          id,
          quantity,
          status,
          order_status,
          created_at,
          meta,
          product_id,
          products!inner(name, price, category)
        `
        )
        .gte("created_at", startISO)
        .lte("created_at", endISO)
        .in("item_type", ["reservation", "order"]);

      if (ordersError) {
        console.error("Error fetching orders:", ordersError);
        throw ordersError;
      }

      const successStatuses = ["completed", "approved", "ready_for_delivery"];
      const statusOf = (row: any) => row.order_status || row.status;

      // Metrics
      const totalOrders = ordersData?.length || 0;
      const successfulOrders =
        ordersData?.filter((o) => successStatuses.includes(statusOf(o))).length ||
        0;
      const cancelledOrders =
        ordersData?.filter((o) => statusOf(o) === "cancelled").length || 0;
      const pendingOrders =
        ordersData?.filter((o) =>
          ["pending_payment", "reserved", "in_production"].includes(statusOf(o))
        ).length || 0;

      let totalSales = 0;
      let totalProductsSold = 0;

      ordersData?.forEach((order) => {
        if (successStatuses.includes(statusOf(order))) {
          const price = (order.products as any)?.price || 0;
          totalSales += price * order.quantity;
          totalProductsSold += order.quantity;
        }
      });

      const averageOrderValue =
        successfulOrders > 0 ? totalSales / successfulOrders : 0;

      setSalesData({
        totalSales,
        totalProductsSold,
        totalOrders,
        successfulOrders,
        cancelledOrders,
        pendingOrders,
        averageOrderValue,
      });

      // Products snapshot + revenue per product inside window
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("*")
        .order("name");

      if (productsError) {
        console.error("Error fetching products:", productsError);
        throw productsError;
      }

      const productsWithSales: ProductData[] = (products || []).map(
        (product) => {
          const productOrders =
            ordersData?.filter(
              (o) =>
                o.product_id === product.id &&
                successStatuses.includes(statusOf(o))
            ) || [];

          const totalSold = productOrders.reduce(
            (sum, o) => sum + o.quantity,
            0
          );
          const revenue = productOrders.reduce(
            (sum, o) => sum + o.quantity * (product.price || 0),
            0
          );

          return {
            id: product.id,
            name: product.name,
            inventory: product.inventory || 0,
            reserved_stock: product.reserved_stock || 0,
            price: product.price || 0,
            category: product.category || "Uncategorized",
            total_sold: totalSold,
            revenue,
          };
        }
      );

      setProductsData(productsWithSales);

      // Daily series
      const labels = enumerateDates(dateRange.startDate, dateRange.endDate);
      const revByDay: Record<string, number> = {};
      const prodByDay: Record<string, number> = {};
      const sucOrdersByDay: Record<string, number> = {};

      labels.forEach((d) => {
        revByDay[d] = 0;
        prodByDay[d] = 0;
        sucOrdersByDay[d] = 0;
      });

      ordersData?.forEach((o) => {
        const key = buildDateKey(o.created_at);
        if (!labels.includes(key)) return;
        if (successStatuses.includes(statusOf(o))) {
          const price = (o.products as any)?.price || 0;
          revByDay[key] += price * o.quantity;
          prodByDay[key] += o.quantity;
          sucOrdersByDay[key] += 1;
        }
      });

      const revenue = labels.map((d) => revByDay[d]);
      const productsSold = labels.map((d) => prodByDay[d]);
      const succOrders = labels.map((d) => sucOrdersByDay[d]);
      const aov = labels.map((d, i) =>
        succOrders[i] > 0 ? revenue[i] / succOrders[i] : 0
      );

      setDailySeries({
        labels,
        revenue,
        products: productsSold,
        successfulOrders: succOrders,
        aov,
      });
    } catch (error) {
      console.error("Error fetching reports data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompleted = async () => {
    try {
      const res = await fetch(`/api/order-management/list-items?status=completed`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load completed orders');
      setCompletedOrders((json.items || []).slice(0, 100));
    } catch (e) {
      console.warn('Completed orders load failed:', e);
      setCompletedOrders([]);
    }
  };

  const generatePDFReport = async () => {
    if (!currentAdmin) return;

    setGeneratingPDF(true);
    try {
      // Optionally ensure charts are fully painted before capture
      // await new Promise((r) => requestAnimationFrame(() => r(null)));

      const pdf = new jsPDF();
      const currentDate = new Date().toLocaleDateString();
      const reportPeriod = `${dateRange.startDate} to ${dateRange.endDate}`;

      // Helper: load public logo (AVIF) and convert to PNG data URL for jsPDF
      const loadImageAsPngDataUrl = (src: string) =>
        new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 256;
            canvas.height = img.naturalHeight || 256;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("Canvas context unavailable"));
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/png");
            resolve({ dataUrl, width: canvas.width, height: canvas.height });
          };
          img.onerror = () => reject(new Error("Failed to load logo image"));
          img.src = "/ge-logo.avif"; // from public/
        });

      // Try to place the logo on the right side of the header
      let headerBottomY = 0;
      try {
        const logo = await loadImageAsPngDataUrl("/ge-logo.avif");
        const pageWidth = (pdf as any).internal.pageSize.getWidth();
        const margin = 20;
        const imgW = 40; // display width in pdf units
        const imgH = imgW * (logo.height / Math.max(1, logo.width));
        const imgX = pageWidth - margin - imgW;
        const imgY = 15; // a little lower to add more top space
        pdf.addImage(logo.dataUrl, "PNG", imgX, imgY, imgW, imgH);
        headerBottomY = imgY + imgH;
      } catch (e) {
        // If logo fails to load, continue without blocking PDF generation
        headerBottomY = 30;
      }

      // Header text (shifted down to add more top whitespace)
      pdf.setFontSize(20);
      pdf.setTextColor(139, 28, 28);
      pdf.text("GRAND EAST SALES REPORT", 20, 35);

      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`Report Period: ${reportPeriod}`, 20, 45);
      pdf.text(`Generated on: ${currentDate}`, 20, 52);
      pdf.text(`Generated by: ${currentAdmin.username}`, 20, 59);

      // Sales Summary Section
      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      // Start this section below the header and logo with extra spacing
      const sectionStartY = Math.max(80, headerBottomY + 20);
      pdf.text("SALES SUMMARY", 20, sectionStartY);

      pdf.setFontSize(11);
      pdf.setTextColor(0, 0, 0);

      const salesSummaryData = [
        ["Metric", "Value"],
        ["Total Revenue", `₱${salesData.totalSales.toLocaleString()}`],
        ["Total Products Sold", salesData.totalProductsSold.toString()],
        ["Total Orders", salesData.totalOrders.toString()],
        ["Successful Orders", salesData.successfulOrders.toString()],
        ["Cancelled Orders", salesData.cancelledOrders.toString()],
        ["Pending Orders", salesData.pendingOrders.toString()],
        [
          "Average Order Value",
          `₱${salesData.averageOrderValue.toLocaleString()}`,
        ],
        [
          "Success Rate",
          `${
            salesData.totalOrders > 0
              ? ((salesData.successfulOrders / salesData.totalOrders) * 100).toFixed(
                  1
                )
              : 0
          }%`,
        ],
      ];

      // FIX: use autoTable function instead of pdf.autoTable
      autoTable(pdf, {
        startY: sectionStartY + 5,
        head: [salesSummaryData[0]],
        body: salesSummaryData.slice(1),
        theme: "striped",
        headStyles: { fillColor: [139, 28, 28] },
        margin: { left: 20, right: 20 },
      });

      // Products Inventory Section
      let currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      pdf.text("PRODUCTS INVENTORY & PERFORMANCE", 20, currentY);

      const productsTableData = productsData.map((product) => [
        product.name,
        product.category,
        product.inventory.toString(),
        product.reserved_stock.toString(),
        `₱${(product.price || 0).toLocaleString()}`,
        product.total_sold.toString(),
        `₱${(product.revenue || 0).toLocaleString()}`,
      ]);

      autoTable(pdf, {
        startY: currentY + 5,
        head: [
          [
            "Product Name",
            "Category",
            "In Stock",
            "Reserved",
            "Price",
            "Sold",
            "Revenue",
          ],
        ],
        body: productsTableData,
        theme: "striped",
        headStyles: { fillColor: [139, 28, 28] },
        margin: { left: 20, right: 20 },
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 25 },
          2: { cellWidth: 20 },
          3: { cellWidth: 20 },
          4: { cellWidth: 25 },
          5: { cellWidth: 20 },
          6: { cellWidth: 30 },
        },
      });

      // Completed Orders Section
      currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      pdf.text("COMPLETED ORDERS", 20, currentY);

      const completedOrdersTableData = completedOrders.map((order) => {
        const addr = order.address_details || {};
        const fullAddress = addr.address || 
          [addr.line1 || addr.street, addr.barangay, addr.city, addr.province || addr.region, addr.postal_code]
            .filter(Boolean)
            .join(', ') || 
          order.delivery_address || 
          '—';
        
        const customerName = addr.full_name || 
          (addr.first_name && addr.last_name ? `${addr.first_name} ${addr.last_name}` : '') ||
          order.customer?.name || 
          order.customer_name || 
          '—';
        
        const phone = addr.phone || order.customer?.phone || order.customer_phone || '—';
        const email = addr.email || order.customer?.email || order.customer_email || '—';
        const branch = addr.branch || '—';
        
        return [
          new Date(order.created_at).toLocaleDateString(),
          customerName,
          `${phone}\n${email}`,
          fullAddress,
          branch,
          order.product_details?.name || order.meta?.product_name || order.product_id || '—',
          order.quantity?.toString() || '0',
          `₱${Number(order.total_paid || 0).toLocaleString()}`,
        ];
      });

      autoTable(pdf, {
        startY: currentY + 5,
        head: [
          [
            "Date",
            "Customer",
            "Contact",
            "Address",
            "Branch",
            "Product",
            "Qty",
            "Total Paid",
          ],
        ],
        body: completedOrdersTableData.length > 0 ? completedOrdersTableData : [['No completed orders in the selected date range', '', '', '', '', '', '', '']],
        theme: "striped",
        headStyles: { fillColor: [139, 28, 28] },
        margin: { left: 20, right: 20 },
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        bodyStyles: { valign: 'top' },
        pageBreak: 'auto',
        // Ensure the table fits within A4 portrait (210mm) minus 20mm margins on each side => 170mm usable.
        // The following widths sum to exactly 170 to prevent overflow.
        tableWidth: 'wrap',
        columnStyles: {
          0: { cellWidth: 18 }, // Date
          1: { cellWidth: 22 }, // Customer
          2: { cellWidth: 26 }, // Contact
          3: { cellWidth: 38 }, // Address
          4: { cellWidth: 16 }, // Branch
          5: { cellWidth: 28 }, // Product
          6: { cellWidth: 8 },  // Qty
          7: { cellWidth: 14 }, // Total Paid
        },
      });

      // Products Inventory & Performance Section
      currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      pdf.text("CATEGORY PERFORMANCE", 20, currentY);

      const categoryData = productsData.reduce((acc, product) => {
        const category = product.category || "Uncategorized";
        if (!acc[category]) {
          acc[category] = {
            totalInventory: 0,
            totalSold: 0,
            totalRevenue: 0,
            productCount: 0,
          };
        }
        acc[category].totalInventory += product.inventory;
        acc[category].totalSold += product.total_sold;
        acc[category].totalRevenue += product.revenue;
        acc[category].productCount += 1;
        return acc;
      }, {} as any);

      const categoryTableData = Object.entries(categoryData).map(
        ([category, data]: [string, any]) => [
          category,
          data.productCount.toString(),
          data.totalInventory.toString(),
          data.totalSold.toString(),
          `₱${(data.totalRevenue || 0).toLocaleString()}`,
        ]
      );

      autoTable(pdf, {
        startY: currentY + 5,
        head: [["Category", "Products", "Total Stock", "Total Sold", "Total Revenue"]],
        body: categoryTableData,
        theme: "striped",
        headStyles: { fillColor: [139, 28, 28] },
        margin: { left: 20, right: 20 },
      });

      // --- NEW: Embed charts as images ---
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;

      let y = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      const addChartToPdf = (chartRef: any, title: string) => {
        const chart = chartRef?.current;
        if (!chart) return;

        // Try both Chart.js APIs to get a base64 image
        const canvas: HTMLCanvasElement | undefined =
          chart.canvas || chart.ctx?.canvas || chartRef?.current?.canvas;
        const imgData =
          typeof chart.toBase64Image === "function"
            ? chart.toBase64Image()
            : canvas?.toDataURL?.("image/png");

        if (!imgData) return;

        const canvasWidth = canvas?.width || 800;
        const canvasHeight = canvas?.height || 400;
        const maxWidth = pageWidth - margin * 2;
        const ratio = canvasHeight / canvasWidth;
        const imgWidth = maxWidth;
        const imgHeight = imgWidth * ratio;

        // New page if not enough space
        if (y + imgHeight + 16 > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }

        // Title
        pdf.setFontSize(14);
        pdf.setTextColor(139, 28, 28);
        pdf.text(title, margin, y);

        // Image
        y += 6;
        pdf.addImage(imgData, "PNG", margin, y, imgWidth, imgHeight);
        y += imgHeight + 16;
      };

      // Charts section
      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      if (y + 12 > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text("CHARTS", margin, y);
      y += 8;

      addChartToPdf(revenueLineRef, "Revenue Over Time");
      addChartToPdf(kpiDoughnutRef, "KPIs Overview");           // CHANGED
      addChartToPdf(ordersStatusRef, "Orders Status Breakdown"); // NEW
      addChartToPdf(categoryRevenueRef, "Revenue by Category");  // NEW

      // Footer page numbers
      const pageCount = pdf.getNumberOfPages();
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.text(
          `Page ${i} of ${pageCount}`,
          pdf.internal.pageSize.getWidth() - 40,
          pdf.internal.pageSize.getHeight() - 10
        );
        pdf.text(
          "Grand East - Confidential Report",
          20,
          pdf.internal.pageSize.getHeight() - 10
        );
      }

      const fileName = `Grand_East_Sales_Report_${dateRange.startDate}_to_${dateRange.endDate}.pdf`;
      pdf.save(fileName);

      // Optional: activity log
      try {
        await fetch("/api/activity-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "generate",
            entity_type: "sales_report",
            entity_id: `report_${Date.now()}`,
            details: `Admin ${currentAdmin.username} generated sales report for period ${reportPeriod}`,
            page: "Reports",
            metadata: {
              reportPeriod,
              totalSales: salesData.totalSales,
              totalOrders: salesData.totalOrders,
              successfulOrders: salesData.successfulOrders,
              productsCount: productsData.length,
              fileName,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString(),
            },
          }),
        });
      } catch (logError) {
        console.warn("Failed to log report generation:", logError);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF report. Please try again.");
    } finally {
      setGeneratingPDF(false);
    }
  };

  // REMOVE: kpiBarData and replace with doughnut data
  // const kpiBarData = useMemo(...)

  // Better KPI overview: multi-axis combo chart over the selected period
  const kpiDoughnutData = useMemo(
    () => ({
      labels: dailySeries.labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Products Sold",
          data: dailySeries.products,
          backgroundColor: "rgba(37,99,235,0.6)",
          borderColor: "#2563EB",
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          type: "bar" as const,
          label: "Successful Orders",
          data: dailySeries.successfulOrders,
          backgroundColor: "rgba(124,58,237,0.6)",
          borderColor: "#7C3AED",
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          type: "line" as const,
          label: "Avg Order Value (₱)",
          data: dailySeries.aov.map((n) => Number(n.toFixed(2))),
          borderColor: "#F97316",
          backgroundColor: "rgba(249,115,22,0.25)",
          tension: 0.3,
          yAxisID: "y1",
          pointRadius: 2,
        },
      ],
    }),
    [dailySeries]
  );

  const ordersStatusData = useMemo(
    () => ({
      labels: ["Successful", "Cancelled", "Pending"],
      datasets: [
        {
          label: "Orders",
          data: [
            salesData.successfulOrders,
            salesData.cancelledOrders,
            salesData.pendingOrders,
          ],
          backgroundColor: ["#16A34A", "#DC2626", "#F59E0B"],
          borderColor: ["#15803D", "#B91C1C", "#D97706"],
          borderWidth: 1,
        },
      ],
    }),
    [salesData]
  );

  const categoryRevenueData = useMemo(() => {
    const map = new Map<string, number>();
    productsData.forEach((p) => {
      const key = p.category || "Uncategorized";
      map.set(key, (map.get(key) || 0) + (p.revenue || 0));
    });
    const labels = Array.from(map.keys());
    const values = labels.map((l) => map.get(l) || 0);
    return {
      labels,
      datasets: [
        {
          label: "Revenue by Category (₱)",
          data: values,
          backgroundColor: "#0EA5E9",
          borderColor: "#0284C7",
        },
      ],
    };
  }, [productsData]);

  const revenueLineData = useMemo(
    () => ({
      labels: dailySeries.labels,
      datasets: [
        {
          label: "Revenue (₱)",
          data: dailySeries.revenue,
          borderColor: "#16A34A",
          backgroundColor: "rgba(22,163,74,0.2)",
          tension: 0.25,
        },
      ],
    }),
    [dailySeries]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Sales Reports</h1>
        <div className="bg-white p-6 rounded-lg shadow-sm text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Loading reports data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Sales Reports</h1>
        <div className="flex items-center space-x-4">
          <div className="text-sm text-gray-600">
            Report by: {currentAdmin?.username || "Unknown Admin"}
          </div>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        {/* Inputs row */}
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, startDate: e.target.value }))
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, endDate: e.target.value }))
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>
        </div>

        {/* Action row: place button below date inputs */}
        <div className="mt-4">
          <button
            onClick={generatePDFReport}
            disabled={generatingPDF}
            className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {generatingPDF ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Generating...</span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>Generate PDF Report</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-green-600">
                ₱{salesData.totalSales.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Products Sold
              </p>
              <p className="text-2xl font-bold text-blue-600">
                {salesData.totalProductsSold}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Successful Orders
              </p>
              <p className="text-2xl font-bold text-purple-600">
                {salesData.successfulOrders}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-full">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Average Order Value
              </p>
              <p className="text-2xl font-bold text-orange-600">
                ₱{salesData.averageOrderValue.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <svg
                className="w-6 h-6 text-orange-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Revenue over time
          </h3>
          <Line
            ref={revenueLineRef}
            data={revenueLineData}
            options={{
              responsive: true,
              plugins: { legend: { display: true } },
              scales: {
                y: {
                  ticks: { callback: (v) => `₱${Number(v).toLocaleString()}` },
                },
              },
            }}
          />
        </div>

        {/* KPIs combo: bars (Products/Orders) + line (AOV) */}
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            KPIs overview
          </h3>
          <div className="mx-auto">
            <Bar
              ref={kpiDoughnutRef}
              data={kpiDoughnutData as any}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: true, position: "top" },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const dsLabel = ctx.dataset.label || "";
                        const val = ctx.parsed?.y ?? ctx.parsed;
                        return dsLabel.includes("(₱)")
                          ? `${dsLabel}: ₱${Number(val || 0).toLocaleString()}`
                          : `${dsLabel}: ${Number(val || 0).toLocaleString()}`;
                      },
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    title: { display: true, text: "Counts" },
                  },
                  y1: {
                    position: "right",
                    beginAtZero: true,
                    grid: { drawOnChartArea: false },
                    ticks: { callback: (v) => `₱${Number(v).toLocaleString()}` },
                    title: { display: true, text: "Avg Order Value (₱)" },
                  },
                },
              }}
              height={280}
            />
          </div>
        </div>
      </div>

      {/* NEW extra charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Orders status breakdown
          </h3>
          <div className="mx-auto flex justify-center">
            <div className="w-[280px] h-[280px]">
              <Doughnut
                ref={ordersStatusRef}
                data={ordersStatusData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false, // enforce 180x180
                  plugins: { legend: { display: true, position: "bottom" } },
                  cutout: "55%",
                }}
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Revenue by category
          </h3>
          <Bar
            ref={categoryRevenueRef}
            data={categoryRevenueData}
            options={{
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: (v) => `₱${Number(v).toLocaleString()}`,
                  },
                },
                x: { ticks: { maxRotation: 45, minRotation: 0 } },
              },
            }}
          />
        </div>
      </div>

      {/* Completed Orders Section */}
      <div className="bg-white rounded-lg shadow-sm border" id="completed-orders-section">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Completed Orders</h2>
          <p className="text-sm text-gray-600 mt-1">
            Showing latest {Math.min(completedOrders.length, 100)} completed orders with customer and address details
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact Info
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Full Address
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Branch
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Paid
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {completedOrders.map((order) => {
                const addr = order.address_details || {};
                const fullAddress = addr.address || 
                  [addr.line1 || addr.street, addr.barangay, addr.city, addr.province || addr.region, addr.postal_code]
                    .filter(Boolean)
                    .join(', ') || 
                  order.delivery_address || 
                  '—';
                
                const customerName = addr.full_name || 
                  (addr.first_name && addr.last_name ? `${addr.first_name} ${addr.last_name}` : '') ||
                  order.customer?.name || 
                  order.customer_name || 
                  '—';
                
                const phone = addr.phone || order.customer?.phone || order.customer_phone || '—';
                const email = addr.email || order.customer?.email || order.customer_email || '—';
                const branch = addr.branch || '—';
                
                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {new Date(order.created_at).toLocaleDateString()}
                      <div className="text-xs text-gray-500">
                        {new Date(order.created_at).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="font-medium text-gray-900">{customerName}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span className="text-xs">{phone}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span className="text-xs text-gray-600">{email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs break-words">
                      {fullAddress}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {branch}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {order.product_details?.name || order.meta?.product_name || order.product_id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center">
                      {order.quantity}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-green-600">
                      ₱{Number(order.total_paid || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {completedOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="text-gray-500">
                      <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm font-medium">No completed orders found</p>
                      <p className="text-sm">Try adjusting your date range</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Products Performance Table (unchanged content below) */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Products Performance
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  In Stock
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reserved
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Units Sold
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {productsData.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {product.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                      {product.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ₱{(product.price || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span
                      className={`font-medium ${
                        product.inventory <= 5 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {product.inventory}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {product.reserved_stock}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {product.total_sold}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                    ₱{(product.revenue || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {productsData.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No products data found
          </h3>
          <p className="text-gray-500">
            No products available for the selected date range.
          </p>
        </div>
      )}
    </div>
  );
}