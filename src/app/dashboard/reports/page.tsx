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

  // Add refs to access the chart instances
  const revenueLineRef = useRef<any>(null);
  const kpiDoughnutRef = useRef<any>(null);        // NEW
  const ordersStatusRef = useRef<any>(null);       // NEW
  const categoryRevenueRef = useRef<any>(null);    // NEW

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

  const generatePDFReport = async () => {
    if (!currentAdmin) return;

    setGeneratingPDF(true);
    try {
      // Optionally ensure charts are fully painted before capture
      // await new Promise((r) => requestAnimationFrame(() => r(null)));

      const pdf = new jsPDF();
      const currentDate = new Date().toLocaleDateString();
      const reportPeriod = `${dateRange.startDate} to ${dateRange.endDate}`;

      // Header
      pdf.setFontSize(20);
      pdf.setTextColor(139, 28, 28);
      pdf.text("GRAND EAST SALES REPORT", 20, 25);

      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`Report Period: ${reportPeriod}`, 20, 35);
      pdf.text(`Generated on: ${currentDate}`, 20, 42);
      pdf.text(`Generated by: ${currentAdmin.username}`, 20, 49);

      // Sales Summary Section
      pdf.setFontSize(16);
      pdf.setTextColor(139, 28, 28);
      pdf.text("SALES SUMMARY", 20, 65);

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
        startY: 70,
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

      // Category Summary
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

  const kpiDoughnutData = useMemo(
    () => ({
      labels: ["Products Sold", "Successful Orders", "Avg Order Value"],
      datasets: [
        {
          label: "KPIs",
          // Note: AOV is a currency; for visualization only
          data: [
            salesData.totalProductsSold,
            salesData.successfulOrders,
            Number(salesData.averageOrderValue.toFixed(2)),
          ],
          backgroundColor: ["#2563EB", "#7C3AED", "#F97316"],
          borderColor: ["#1E40AF", "#5B21B6", "#C2410C"],
          borderWidth: 1,
        },
      ],
    }),
    [salesData]
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
              className="px-3 py-2 border border-gray-300 rounded-lg"
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
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div className="pt-6">
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

        {/* KPIs as circle (doughnut) */}
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            KPIs overview
          </h3>
          <div className="mx-auto flex justify-center">
            <div className="w-[280px] h-[280px]">
              <Doughnut
                ref={kpiDoughnutRef}
                data={kpiDoughnutData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false, // enforce 180x180
                  plugins: {
                    legend: { display: true, position: "bottom" },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const label = ctx.label || "";
                          const val = ctx.parsed as number;
                          return label.includes("Value")
                            ? `${label}: ₱${val.toLocaleString()}`
                            : `${label}: ${val.toLocaleString()}`;
                        },
                      },
                    },
                  },
                  cutout: "60%",
                }}
              />
            </div>
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