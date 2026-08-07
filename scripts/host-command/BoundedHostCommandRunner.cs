using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace ShuHai.HostCommand
{
    public sealed class RunnerProfile
    {
        public string Classification { get; set; }
        public int WallMilliseconds { get; set; }
        public int IdleMilliseconds { get; set; }
        public long StdoutBytes { get; set; }
        public long StderrBytes { get; set; }
        public long AggregateBytes { get; set; }
        public ulong ProcessMemoryBytes { get; set; }
        public ulong JobMemoryBytes { get; set; }
        public uint ProcessCount { get; set; }
        public int MutexWaitMilliseconds { get; set; }
        public int CleanupMilliseconds { get; set; }
        public int ChunkBytes { get; set; }
        public int RingBytes { get; set; }

        public void Validate()
        {
            if (Classification != "quick" && Classification != "heavy")
                throw new ArgumentException("profile_classification_invalid");
            Positive(WallMilliseconds, 1800000, "wall");
            Positive(IdleMilliseconds, 300000, "idle");
            Positive(StdoutBytes, 1048576, "stdout");
            Positive(StderrBytes, 1048576, "stderr");
            Positive(AggregateBytes, 1572864, "aggregate");
            Positive(ProcessMemoryBytes, 2147483648UL, "process_memory");
            Positive(JobMemoryBytes, 4294967296UL, "job_memory");
            Positive(ProcessCount, 32U, "process_count");
            Positive(MutexWaitMilliseconds, 5000, "mutex_wait");
            Positive(CleanupMilliseconds, 30000, "cleanup");
            Positive(ChunkBytes, 65536, "chunk");
            Positive(RingBytes, 8192, "ring");
            if (ProcessMemoryBytes > JobMemoryBytes ||
                AggregateBytes > StdoutBytes + StderrBytes ||
                RingBytes > AggregateBytes || ChunkBytes > AggregateBytes)
                throw new ArgumentException("profile_relationship_invalid");
        }

        private static void Positive(long value, long maximum, string name)
        {
            if (value <= 0 || value > maximum) throw new ArgumentException("profile_" + name + "_invalid");
        }

        private static void Positive(ulong value, ulong maximum, string name)
        {
            if (value == 0 || value > maximum) throw new ArgumentException("profile_" + name + "_invalid");
        }

        private static void Positive(uint value, uint maximum, string name)
        {
            if (value == 0 || value > maximum) throw new ArgumentException("profile_" + name + "_invalid");
        }
    }

    public sealed class RunnerRequest
    {
        public string OperationId { get; set; }
        public string ExecutablePath { get; set; }
        public string[] Arguments { get; set; }
        public string WorkingDirectory { get; set; }
        public int ParentPid { get; set; }
        public long ParentStartFileTime { get; set; }
        public string MutexName { get; set; }
        public string ReceiptPath { get; set; }
        public int ReceiptMaxBytes { get; set; }
        public RunnerProfile Profile { get; set; }
        public int CancelAfterMilliseconds { get; set; }
        public int ParentExceptionAfterMilliseconds { get; set; }
    }

    public sealed class RunnerResult
    {
        public string OperationId;
        public string Status;
        public string Reason;
        public int ExitCode;
        public int TargetExitCode;
        public bool TargetStarted;
        public int ChildPID;
        public long ChildStartFileTime;
        public int ParentPID;
        public long ParentStartFileTime;
        public long StdoutBytes;
        public long StderrBytes;
        public long AggregateBytes;
        public string StdoutSha256;
        public string StderrSha256;
        public bool JobEmpty;
        public int FinalOwnedPIDCount;
        public int FinalOwnedTCPPortCount;
        public int FinalOwnedUDPPortCount;
        public bool ReadersJoined;
        public bool HandleObligationsProven;
        public bool LedgerProven;
        public int ObligationCount;
        public int UnprovenObligationCount;
        public int CleanupInvocations;
        public int SecondaryCleanupErrors;
        public bool LaneAcquired;
        public string Classification;
        public RunnerProfile Limits;
        public long ElapsedMilliseconds;
        public string FinishedAtUtc;

        public string ToJson()
        {
            StringBuilder b = new StringBuilder(2048);
            b.Append('{');
            Field(b, "operation", OperationId, true);
            Field(b, "status", Status, false);
            Field(b, "reason", Reason, false);
            Number(b, "exitCode", ExitCode);
            Number(b, "targetExitCode", TargetExitCode);
            Bool(b, "targetStarted", TargetStarted);
            Number(b, "ChildPID", ChildPID);
            Number(b, "childStartFileTime", ChildStartFileTime);
            Number(b, "parentPID", ParentPID);
            Number(b, "parentStartFileTime", ParentStartFileTime);
            Number(b, "stdoutBytes", StdoutBytes);
            Number(b, "stderrBytes", StderrBytes);
            Number(b, "aggregateBytes", AggregateBytes);
            Field(b, "stdoutSha256", StdoutSha256, false);
            Field(b, "stderrSha256", StderrSha256, false);
            Bool(b, "JobEmpty", JobEmpty);
            Number(b, "finalOwnedPIDCount", FinalOwnedPIDCount);
            Number(b, "finalOwnedTCPPortCount", FinalOwnedTCPPortCount);
            Number(b, "finalOwnedUDPPortCount", FinalOwnedUDPPortCount);
            Bool(b, "readersJoined", ReadersJoined);
            Bool(b, "handleObligationsProven", HandleObligationsProven);
            Bool(b, "ledgerProven", LedgerProven);
            Number(b, "obligationCount", ObligationCount);
            Number(b, "unprovenObligationCount", UnprovenObligationCount);
            Number(b, "cleanupInvocations", CleanupInvocations);
            Number(b, "secondaryCleanupErrors", SecondaryCleanupErrors);
            Bool(b, "laneAcquired", LaneAcquired);
            Field(b, "classification", Classification, false);
            Number(b, "elapsedMilliseconds", ElapsedMilliseconds);
            Field(b, "finishedAtUtc", FinishedAtUtc, false);
            b.Append(",\"limits\":{");
            Field(b, "profileClass", Limits.Classification, true);
            Number(b, "wallMilliseconds", Limits.WallMilliseconds);
            Number(b, "idleMilliseconds", Limits.IdleMilliseconds);
            Number(b, "stdoutBytes", Limits.StdoutBytes);
            Number(b, "stderrBytes", Limits.StderrBytes);
            Number(b, "aggregateBytes", Limits.AggregateBytes);
            Number(b, "processMemoryBytes", Limits.ProcessMemoryBytes);
            Number(b, "jobMemoryBytes", Limits.JobMemoryBytes);
            Number(b, "processCount", Limits.ProcessCount);
            Number(b, "mutexWaitMilliseconds", Limits.MutexWaitMilliseconds);
            Number(b, "cleanupMilliseconds", Limits.CleanupMilliseconds);
            b.Append('}');
            b.Append('}');
            return b.ToString();
        }

        private static void Field(StringBuilder b, string name, string value, bool first)
        {
            if (!first) b.Append(',');
            b.Append('\"').Append(Escape(name)).Append("\":\"").Append(Escape(value ?? "")).Append('\"');
        }

        private static void Number(StringBuilder b, string name, long value)
        {
            b.Append(",\"").Append(Escape(name)).Append("\":").Append(value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        private static void Number(StringBuilder b, string name, ulong value)
        {
            b.Append(",\"").Append(Escape(name)).Append("\":").Append(value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        private static void Bool(StringBuilder b, string name, bool value)
        {
            b.Append(",\"").Append(Escape(name)).Append("\":").Append(value ? "true" : "false");
        }

        private static string Escape(string value)
        {
            StringBuilder b = new StringBuilder(value.Length + 16);
            foreach (char c in value)
            {
                switch (c)
                {
                    case '\\': b.Append("\\\\"); break;
                    case '\"': b.Append("\\\""); break;
                    case '\b': b.Append("\\b"); break;
                    case '\f': b.Append("\\f"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
                        else b.Append(c);
                        break;
                }
            }
            return b.ToString();
        }
    }

    internal sealed class Obligation
    {
        public string Kind;
        public string State;
        public bool Proven;
        public Obligation Successor;
    }

    internal sealed class ResourceLedger
    {
        private readonly List<Obligation> items = new List<Obligation>();

        public Obligation Reserve(string kind)
        {
            Obligation value = new Obligation { Kind = kind, State = "reserved", Proven = false };
            lock (items) items.Add(value);
            return value;
        }

        public void Bind(Obligation item)
        {
            lock (items)
            {
                if (item.State != "reserved" || item.Proven) throw new InvalidOperationException("obligation_not_bindable");
                item.State = "owned";
            }
        }

        public void Transfer(Obligation from, Obligation to)
        {
            lock (items)
            {
                if (from.Proven || from.State == "failed" || to.Proven)
                    throw new InvalidOperationException("obligation_not_transferable");
                from.State = "transferred";
                from.Successor = to;
            }
        }

        public void Prove(Obligation item, string state)
        {
            lock (items)
            {
                if (item.State == "transferred") throw new InvalidOperationException("transferred_obligation_not_directly_proven");
                item.State = state;
                item.Proven = true;
            }
        }

        public void Fail(Obligation item)
        {
            lock (items)
            {
                item.State = "failed";
                item.Proven = false;
            }
        }

        public int Count { get { lock (items) return items.Count; } }

        public int UnprovenCount
        {
            get
            {
                lock (items)
                {
                    int count = 0;
                    foreach (Obligation item in items) if (!Resolved(item, new HashSet<Obligation>())) count++;
                    return count;
                }
            }
        }

        public bool AllProven { get { return Count > 0 && UnprovenCount == 0; } }

        private static bool Resolved(Obligation item, HashSet<Obligation> seen)
        {
            if (item.Proven) return true;
            if (item.State != "transferred" || item.Successor == null || !seen.Add(item)) return false;
            return Resolved(item.Successor, seen);
        }
    }

    internal sealed class SharedOutput
    {
        public readonly object Sync = new object();
        public long TotalSeen;
        public long LastActivityTimestamp;
        public string Violation;
    }

    internal sealed class StreamState
    {
        public readonly string Name;
        public readonly IntPtr Handle;
        public readonly long Limit;
        public readonly byte[] Ring;
        public readonly SHA256 Hash;
        public long Seen;
        public int RingPosition;
        public int RingCount;
        public bool Completed;
        public bool ReaderError;
        public string Digest;
        public Thread Thread;
        public Obligation ReaderObligation;
        public Obligation DigestObligation;
        private bool hashFinalized;

        public StreamState(string name, IntPtr handle, long limit, int ringBytes, SHA256 hash, Obligation digestObligation)
        {
            Name = name;
            Handle = handle;
            Limit = limit;
            Ring = new byte[ringBytes];
            Hash = hash;
            DigestObligation = digestObligation;
        }

        public void Retain(byte[] buffer, int count)
        {
            if (count <= 0) return;
            Hash.TransformBlock(buffer, 0, count, null, 0);
            for (int i = 0; i < count; i++)
            {
                Ring[RingPosition] = buffer[i];
                RingPosition = (RingPosition + 1) % Ring.Length;
                if (RingCount < Ring.Length) RingCount++;
            }
        }

        public void FinalizeDigest(ResourceLedger ledger, ref int cleanupErrors)
        {
            if (!hashFinalized)
            {
                try
                {
                    Hash.TransformFinalBlock(new byte[0], 0, 0);
                    Digest = Hex(Hash.Hash);
                    hashFinalized = true;
                    Hash.Dispose();
                    ledger.Prove(DigestObligation, "digest-finalized");
                }
                catch
                {
                    cleanupErrors++;
                    ledger.Fail(DigestObligation);
                    try { Hash.Dispose(); } catch { cleanupErrors++; }
                    Digest = "digest_unproven";
                }
            }
        }

        private static string Hex(byte[] bytes)
        {
            StringBuilder b = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes) b.Append(value.ToString("x2"));
            return b.ToString();
        }
    }

    public static class BoundedHostCommandRunner
    {
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint STARTF_USESTDHANDLES = 0x00000100;
        private const uint HANDLE_FLAG_INHERIT = 0x00000001;
        private const uint GENERIC_READ = 0x80000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint OPEN_EXISTING = 3;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;
        private const uint STILL_ACTIVE = 259;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const uint SYNCHRONIZE = 0x00100000;
        private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
        private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
        private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectBasicAccountingInformation = 1;
        private const int JobObjectExtendedLimitInformation = 9;
        private const int ERROR_BROKEN_PIPE = 109;
        private const string ReceiptMutexName = "Local\\ShuHaiHostCommandReceipt-v1";
        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        private sealed class ReceiptReservation
        {
            public string PendingPath;
            public Mutex ReceiptMutex;
            public bool MutexOwned;
            public FileStream PendingStream;
            public bool PendingOwned;
            public bool Committed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME
        {
            public uint dwLowDateTime;
            public uint dwHighDateTime;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint length, IntPtr returnedLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES attributes, uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint creation, uint flags, IntPtr template);

        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessW(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ReadFile(IntPtr file, byte[] buffer, uint bytesToRead, out uint bytesRead, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);

        public static void ValidateProfile(RunnerProfile profile)
        {
            if (profile == null) throw new ArgumentException("profile_missing");
            profile.Validate();
        }

        public static RunnerResult Run(RunnerRequest request)
        {
            ValidateRequest(request);
            ResourceLedger ledger = new ResourceLedger();
            Obligation operationProof = ledger.Reserve("operation-start-proof");
            ledger.Bind(operationProof);
            ledger.Prove(operationProof, "started");
            Stopwatch elapsed = Stopwatch.StartNew();
            SharedOutput shared = new SharedOutput { LastActivityTimestamp = Stopwatch.GetTimestamp() };
            RunnerResult result = NewResult(request);
            Mutex lane = null;
            bool laneOwned = false;
            Obligation laneObligation = null;
            ReceiptReservation receiptReservation = null;
            bool deferReceiptReservation = false;
            IntPtr parentHandle = IntPtr.Zero;
            Obligation parentObligation = null;
            IntPtr job = IntPtr.Zero;
            Obligation jobHandleObligation = null;
            Obligation treeObligation = null;
            IntPtr stdoutRead = IntPtr.Zero;
            IntPtr stdoutWrite = IntPtr.Zero;
            IntPtr stderrRead = IntPtr.Zero;
            IntPtr stderrWrite = IntPtr.Zero;
            IntPtr stdinNull = IntPtr.Zero;
            Obligation stdoutReadObligation = null;
            Obligation stdoutWriteObligation = null;
            Obligation stderrReadObligation = null;
            Obligation stderrWriteObligation = null;
            Obligation stdinObligation = null;
            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
            Obligation processObligation = null;
            Obligation processHandleObligation = null;
            Obligation threadHandleObligation = null;
            Obligation environmentObligation = null;
            StreamState stdout = null;
            StreamState stderr = null;
            bool mustTerminate = false;
            bool processExited = false;
            bool processAssignedToJob = false;
            bool readersJoined = true;
            bool jobEmpty = true;
            int targetExit = -1;

            try
            {
                if (request.Profile.Classification == "heavy")
                {
                    laneObligation = ledger.Reserve("heavy-lane-mutex");
                    lane = new Mutex(false, request.MutexName);
                    ledger.Bind(laneObligation);
                    try
                    {
                        laneOwned = lane.WaitOne(request.Profile.MutexWaitMilliseconds, false);
                    }
                    catch (AbandonedMutexException)
                    {
                        laneOwned = true;
                        result.Reason = "lane_abandoned";
                        result.Status = "blocked";
                        result.ExitCode = 75;
                        deferReceiptReservation = true;
                        throw new InvalidOperationException("lane_abandoned_control");
                    }
                    if (!laneOwned)
                    {
                        result.Reason = "lane_busy";
                        result.Status = "blocked";
                        result.ExitCode = 75;
                        deferReceiptReservation = true;
                        throw new InvalidOperationException("lane_busy_control");
                    }
                    result.LaneAcquired = true;
                }

                receiptReservation = ReserveReceipt(request);

                parentObligation = ledger.Reserve("parent-identity-handle");
                parentHandle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)request.ParentPid);
                if (parentHandle == IntPtr.Zero)
                {
                    ledger.Prove(parentObligation, "no-resource");
                    throw Win32("parent_open_failed");
                }
                ledger.Bind(parentObligation);
                if (CreationFileTime(parentHandle) != request.ParentStartFileTime)
                    throw new InvalidOperationException("parent_identity_mismatch");

                jobHandleObligation = ledger.Reserve("job-handle");
                job = CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero)
                {
                    ledger.Prove(jobHandleObligation, "no-resource");
                    throw Win32("job_create_failed");
                }
                ledger.Bind(jobHandleObligation);
                ConfigureJob(job, request.Profile);
                treeObligation = ledger.Reserve("job-tree-empty-proof");
                ledger.Bind(treeObligation);

                SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
                security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                security.bInheritHandle = true;

                stdoutReadObligation = ledger.Reserve("stdout-read-handle");
                stdoutWriteObligation = ledger.Reserve("stdout-write-handle");
                if (!CreatePipe(out stdoutRead, out stdoutWrite, ref security, 0))
                {
                    ledger.Prove(stdoutReadObligation, "no-resource");
                    ledger.Prove(stdoutWriteObligation, "no-resource");
                    throw Win32("stdout_pipe_create_failed");
                }
                ledger.Bind(stdoutReadObligation);
                ledger.Bind(stdoutWriteObligation);
                if (!SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0)) throw Win32("stdout_inherit_clear_failed");

                stderrReadObligation = ledger.Reserve("stderr-read-handle");
                stderrWriteObligation = ledger.Reserve("stderr-write-handle");
                if (!CreatePipe(out stderrRead, out stderrWrite, ref security, 0))
                {
                    ledger.Prove(stderrReadObligation, "no-resource");
                    ledger.Prove(stderrWriteObligation, "no-resource");
                    throw Win32("stderr_pipe_create_failed");
                }
                ledger.Bind(stderrReadObligation);
                ledger.Bind(stderrWriteObligation);
                if (!SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0)) throw Win32("stderr_inherit_clear_failed");

                stdinObligation = ledger.Reserve("stdin-null-handle");
                stdinNull = CreateFile("NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, OPEN_EXISTING, 0, IntPtr.Zero);
                if (stdinNull == INVALID_HANDLE_VALUE)
                {
                    stdinNull = IntPtr.Zero;
                    ledger.Prove(stdinObligation, "no-resource");
                    throw Win32("stdin_null_open_failed");
                }
                ledger.Bind(stdinObligation);

                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                startup.dwFlags = STARTF_USESTDHANDLES;
                startup.hStdInput = stdinNull;
                startup.hStdOutput = stdoutWrite;
                startup.hStdError = stderrWrite;
                processObligation = ledger.Reserve("process-disposition");
                processHandleObligation = ledger.Reserve("process-handle");
                threadHandleObligation = ledger.Reserve("primary-thread-handle");
                environmentObligation = ledger.Reserve("environment-block");
                IntPtr environment = IntPtr.Zero;
                try
                {
                    environment = BuildEnvironment(request.OperationId, request.WorkingDirectory, ledger);
                    ledger.Bind(environmentObligation);
                    StringBuilder command = new StringBuilder(BuildCommandLine(request.ExecutablePath, request.Arguments));
                    if (!CreateProcessW(
                        request.ExecutablePath,
                        command,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        true,
                        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                        environment,
                        request.WorkingDirectory,
                        ref startup,
                        out pi))
                    {
                        ledger.Prove(processObligation, "no-resource");
                        ledger.Prove(processHandleObligation, "no-resource");
                        ledger.Prove(threadHandleObligation, "no-resource");
                        throw Win32("process_create_failed");
                    }
                }
                finally
                {
                    if (environment != IntPtr.Zero)
                    {
                        try
                        {
                            Marshal.FreeHGlobal(environment);
                            ledger.Prove(environmentObligation, "freed");
                        }
                        catch
                        {
                            result.SecondaryCleanupErrors++;
                            ledger.Fail(environmentObligation);
                        }
                    }
                    else if (environmentObligation.State == "reserved")
                    {
                        ledger.Prove(environmentObligation, "no-resource");
                    }
                }
                ledger.Bind(processObligation);
                ledger.Bind(processHandleObligation);
                ledger.Bind(threadHandleObligation);
                result.TargetStarted = true;
                result.ChildPID = checked((int)pi.dwProcessId);
                result.ChildStartFileTime = CreationFileTime(pi.hProcess);

                CloseTracked(ref stdoutWrite, stdoutWriteObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stderrWrite, stderrWriteObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stdinNull, stdinObligation, ledger, ref result.SecondaryCleanupErrors);

                if (!AssignProcessToJobObject(job, pi.hProcess))
                {
                    mustTerminate = true;
                    throw Win32("job_assign_failed");
                }
                processAssignedToJob = true;
                ledger.Transfer(processObligation, treeObligation);

                stdout = CreateStreamState("stdout", stdoutRead, request.Profile.StdoutBytes, request.Profile.RingBytes, ledger);
                stderr = CreateStreamState("stderr", stderrRead, request.Profile.StderrBytes, request.Profile.RingBytes, ledger);
                StartReader(stdout, shared, request.Profile, ledger);
                StartReader(stderr, shared, request.Profile, ledger);

                uint previousSuspendCount = ResumeThread(pi.hThread);
                if (previousSuspendCount == UInt32.MaxValue || previousSuspendCount != 1)
                {
                    mustTerminate = true;
                    throw Win32("process_resume_failed");
                }
                shared.LastActivityTimestamp = Stopwatch.GetTimestamp();

                while (true)
                {
                    if (request.ParentExceptionAfterMilliseconds > 0 && elapsed.ElapsedMilliseconds >= request.ParentExceptionAfterMilliseconds)
                        throw new InvalidOperationException("synthetic_parent_exception");
                    if (request.CancelAfterMilliseconds > 0 && elapsed.ElapsedMilliseconds >= request.CancelAfterMilliseconds)
                    {
                        result.Reason = "cancelled";
                        mustTerminate = true;
                        break;
                    }
                    if (WaitForSingleObject(parentHandle, 0) == WAIT_OBJECT_0 ||
                        CreationFileTime(parentHandle) != request.ParentStartFileTime)
                    {
                        result.Reason = "parent_disappeared";
                        mustTerminate = true;
                        break;
                    }
                    string violation;
                    long lastActivity;
                    lock (shared.Sync)
                    {
                        violation = shared.Violation;
                        lastActivity = shared.LastActivityTimestamp;
                    }
                    if (violation != null)
                    {
                        result.Reason = violation;
                        mustTerminate = true;
                        break;
                    }
                    if (elapsed.ElapsedMilliseconds >= request.Profile.WallMilliseconds)
                    {
                        result.Reason = "wall_timeout";
                        mustTerminate = true;
                        break;
                    }
                    if (ElapsedSince(lastActivity) >= request.Profile.IdleMilliseconds)
                    {
                        result.Reason = "idle_timeout";
                        mustTerminate = true;
                        break;
                    }
                    uint wait = WaitForSingleObject(pi.hProcess, 20);
                    if (wait == WAIT_OBJECT_0)
                    {
                        processExited = true;
                        break;
                    }
                    if (wait != WAIT_TIMEOUT) throw Win32("process_wait_failed");
                }

                if (mustTerminate) TerminateOwnedTree(job, result);
                if (!processExited)
                    processExited = WaitForSingleObject(pi.hProcess, (uint)request.Profile.CleanupMilliseconds) == WAIT_OBJECT_0;
                uint rawExit;
                if (processExited && GetExitCodeProcess(pi.hProcess, out rawExit))
                {
                    targetExit = unchecked((int)rawExit);
                }
                else if (!processExited)
                {
                    result.Reason = "process_exit_unproven";
                }

                if (!mustTerminate && processExited)
                {
                    if (targetExit != 0)
                    {
                        result.Reason = "target_exit_nonzero";
                        if (ActiveProcesses(job) > 0) TerminateOwnedTree(job, result);
                    }
                    else if (!WaitJobEmpty(job, Math.Min(500, request.Profile.CleanupMilliseconds)))
                    {
                        result.Reason = "descendant_survived_root";
                        TerminateOwnedTree(job, result);
                    }
                    else
                    {
                        result.Reason = "completed";
                    }
                }
                jobEmpty = WaitJobEmpty(job, request.Profile.CleanupMilliseconds);
            }
            catch (Exception error)
            {
                if (result.Reason == "not_started")
                    result.Reason = error.Message == "synthetic_parent_exception" ? "parent_exception" : "runner_exception";
                mustTerminate = result.TargetStarted;
            }
            finally
            {
                if (mustTerminate && result.TargetStarted && !processAssignedToJob && pi.hProcess != IntPtr.Zero)
                {
                    TerminateOwnedProcess(pi.hProcess, result);
                    processExited = WaitForSingleObject(pi.hProcess, (uint)request.Profile.CleanupMilliseconds) == WAIT_OBJECT_0;
                }
                if (mustTerminate && processAssignedToJob && job != IntPtr.Zero && !SafeJobEmpty(job) && result.CleanupInvocations == 0)
                    TerminateOwnedTree(job, result);
                if (job != IntPtr.Zero) jobEmpty = WaitJobEmpty(job, request.Profile.CleanupMilliseconds);

                readersJoined = JoinReader(stdout, request.Profile.CleanupMilliseconds, ledger, ref result.SecondaryCleanupErrors) &
                    JoinReader(stderr, request.Profile.CleanupMilliseconds, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stdoutRead, stdoutReadObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stderrRead, stderrReadObligation, ledger, ref result.SecondaryCleanupErrors);

                if (treeObligation != null)
                {
                    if (jobEmpty) ledger.Prove(treeObligation, "job-empty");
                    else ledger.Fail(treeObligation);
                }
                if (processObligation != null && processObligation.State == "owned")
                {
                    if (processExited || (pi.hProcess != IntPtr.Zero && WaitForSingleObject(pi.hProcess, 0) == WAIT_OBJECT_0))
                        ledger.Prove(processObligation, "unassigned-process-exited");
                    else
                        ledger.Fail(processObligation);
                }
                CloseTracked(ref pi.hThread, threadHandleObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref pi.hProcess, processHandleObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stdoutWrite, stdoutWriteObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stderrWrite, stderrWriteObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref stdinNull, stdinObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref job, jobHandleObligation, ledger, ref result.SecondaryCleanupErrors);
                CloseTracked(ref parentHandle, parentObligation, ledger, ref result.SecondaryCleanupErrors);

                if (lane != null)
                {
                    try
                    {
                        if (laneOwned) lane.ReleaseMutex();
                    }
                    catch
                    {
                        result.SecondaryCleanupErrors++;
                        if (laneObligation != null) ledger.Fail(laneObligation);
                    }
                    try
                    {
                        lane.Dispose();
                        if (laneObligation != null && laneObligation.State != "failed") ledger.Prove(laneObligation, "released");
                    }
                    catch
                    {
                        result.SecondaryCleanupErrors++;
                        if (laneObligation != null) ledger.Fail(laneObligation);
                    }
                }
            }

            result.TargetExitCode = targetExit;
            result.JobEmpty = jobEmpty;
            result.ReadersJoined = readersJoined;
            lock (shared.Sync)
            {
                if (shared.Violation != null && (result.Reason == "completed" || result.Reason == "not_started"))
                    result.Reason = shared.Violation;
            }
            bool behaviorSuccess = result.Reason == "completed" && targetExit == 0;
            result.Status = behaviorSuccess ? "ok" : result.Status == "blocked" ? "blocked" : "failed";
            result.ExitCode = behaviorSuccess ? 0 : result.ExitCode == 75 ? 75 : 70;
            return FinalizeResult(
                request,
                result,
                ledger,
                elapsed,
                stdout,
                stderr,
                jobEmpty,
                readersJoined,
                receiptReservation,
                deferReceiptReservation);
        }

        private static RunnerResult NewResult(RunnerRequest request)
        {
            return new RunnerResult
            {
                OperationId = request.OperationId,
                Status = "failed",
                Reason = "not_started",
                ExitCode = 70,
                TargetExitCode = -1,
                ParentPID = request.ParentPid,
                ParentStartFileTime = request.ParentStartFileTime,
                JobEmpty = true,
                ReadersJoined = true,
                Classification = request.Profile.Classification,
                Limits = request.Profile,
                StdoutSha256 = EmptyDigest(),
                StderrSha256 = EmptyDigest(),
            };
        }

        private static RunnerResult FinalizeResult(
            RunnerRequest request,
            RunnerResult result,
            ResourceLedger ledger,
            Stopwatch elapsed,
            StreamState stdout,
            StreamState stderr,
            bool jobEmpty,
            bool readersJoined,
            ReceiptReservation receiptReservation,
            bool deferReceiptReservation)
        {
            bool committed = false;
            try
            {
                if (stdout != null)
                {
                    stdout.FinalizeDigest(ledger, ref result.SecondaryCleanupErrors);
                    result.StdoutBytes = stdout.Seen;
                    result.StdoutSha256 = stdout.Digest;
                }
                if (stderr != null)
                {
                    stderr.FinalizeDigest(ledger, ref result.SecondaryCleanupErrors);
                    result.StderrBytes = stderr.Seen;
                    result.StderrSha256 = stderr.Digest;
                }
                result.AggregateBytes = SaturatingAdd(result.StdoutBytes, result.StderrBytes);
                result.JobEmpty = jobEmpty;
                result.ReadersJoined = readersJoined;
                result.FinalOwnedPIDCount = jobEmpty ? 0 : 1;
                result.FinalOwnedTCPPortCount = jobEmpty ? 0 : -1;
                result.FinalOwnedUDPPortCount = jobEmpty ? 0 : -1;
                result.ObligationCount = ledger.Count;
                result.UnprovenObligationCount = ledger.UnprovenCount;
                result.LedgerProven = ledger.AllProven;
                result.HandleObligationsProven = result.LedgerProven;
                result.ElapsedMilliseconds = elapsed.ElapsedMilliseconds;
                result.FinishedAtUtc = DateTime.UtcNow.ToString("o");
                if (!result.JobEmpty || !result.ReadersJoined || !result.LedgerProven || result.SecondaryCleanupErrors != 0)
                {
                    result.Status = "failed";
                    result.ExitCode = 70;
                    if (result.Reason == "completed") result.Reason = "cleanup_unproven";
                }

                if (receiptReservation == null && deferReceiptReservation)
                {
                    receiptReservation = ReserveReceipt(request);
                }

                if (receiptReservation != null)
                {
                    PublishReceipt(request, result, receiptReservation);
                    committed = receiptReservation.Committed;
                }
                return result;
            }
            catch
            {
                result.Status = "failed";
                result.ExitCode = 70;
                if (result.Reason == "completed") result.Reason = "receipt_write_failed";
                return result;
            }
            finally
            {
                if (committed) ReleaseCommittedReceipt(receiptReservation);
                else CleanupUncommittedReceipt(receiptReservation);
            }
        }

        private static void ValidateRequest(RunnerRequest request)
        {
            if (request == null) throw new ArgumentException("request_missing");
            ValidateProfile(request.Profile);
            if (String.IsNullOrEmpty(request.OperationId) || request.OperationId.Length > 80)
                throw new ArgumentException("operation_invalid");
            if (String.IsNullOrEmpty(request.ExecutablePath) || !Path.IsPathRooted(request.ExecutablePath) ||
                !File.Exists(request.ExecutablePath) || !String.Equals(Path.GetExtension(request.ExecutablePath), ".exe", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("executable_invalid");
            if (request.Arguments == null || request.Arguments.Length > 96) throw new ArgumentException("arguments_invalid");
            foreach (string arg in request.Arguments)
                if (arg == null || arg.Length > 2048 || arg.IndexOf('\0') >= 0 || arg.IndexOf('\r') >= 0 || arg.IndexOf('\n') >= 0)
                    throw new ArgumentException("argument_invalid");
            if (String.IsNullOrEmpty(request.WorkingDirectory) || !Path.IsPathRooted(request.WorkingDirectory) || !Directory.Exists(request.WorkingDirectory))
                throw new ArgumentException("working_directory_invalid");
            if (request.ParentPid <= 0 || request.ParentStartFileTime <= 0) throw new ArgumentException("parent_identity_invalid");
            if (request.MutexName != "Local\\CodexHostHeavyLane-v1") throw new ArgumentException("mutex_invalid");
            string expectedReceipt = Path.GetFullPath(Path.Combine(request.WorkingDirectory, ".tmp", "host-command", "current.json"));
            if (!String.Equals(Path.GetFullPath(request.ReceiptPath), expectedReceipt, StringComparison.OrdinalIgnoreCase) || request.ReceiptMaxBytes != 32768)
                throw new ArgumentException("receipt_invalid");
            if (request.CancelAfterMilliseconds < 0 || request.ParentExceptionAfterMilliseconds < 0 ||
                request.CancelAfterMilliseconds >= request.Profile.WallMilliseconds ||
                request.ParentExceptionAfterMilliseconds >= request.Profile.WallMilliseconds)
                throw new ArgumentException("test_trigger_invalid");
            if (BuildCommandLine(request.ExecutablePath, request.Arguments).Length >= 32767)
                throw new ArgumentException("command_line_too_long");
        }

        private static void ConfigureJob(IntPtr job, RunnerProfile profile)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = profile.ProcessCount;
            limits.ProcessMemoryLimit = new UIntPtr(profile.ProcessMemoryBytes);
            limits.JobMemoryLimit = new UIntPtr(profile.JobMemoryBytes);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                throw Win32("job_limit_configuration_failed");
        }

        private static void StartReader(StreamState state, SharedOutput shared, RunnerProfile profile, ResourceLedger ledger)
        {
            state.ReaderObligation = ledger.Reserve(state.Name + "-reader-thread");
            state.Thread = new Thread(delegate() { ReaderLoop(state, shared, profile); });
            state.Thread.IsBackground = true;
            state.Thread.Name = "ShuHaiBounded-" + state.Name;
            state.Thread.Start();
            ledger.Bind(state.ReaderObligation);
        }

        private static StreamState CreateStreamState(string name, IntPtr handle, long limit, int ringBytes, ResourceLedger ledger)
        {
            Obligation digestObligation = ledger.Reserve(name + "-digest-context");
            SHA256 hash = null;
            try
            {
                hash = SHA256.Create();
                ledger.Bind(digestObligation);
                return new StreamState(name, handle, limit, ringBytes, hash, digestObligation);
            }
            catch
            {
                if (hash == null) ledger.Prove(digestObligation, "no-resource");
                else
                {
                    try { hash.Dispose(); ledger.Prove(digestObligation, "closed-after-create-failure"); }
                    catch { ledger.Fail(digestObligation); }
                }
                throw;
            }
        }

        private static void ReaderLoop(StreamState state, SharedOutput shared, RunnerProfile profile)
        {
            byte[] buffer = new byte[profile.ChunkBytes];
            try
            {
                while (true)
                {
                    uint read;
                    bool ok = ReadFile(state.Handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
                    if (!ok)
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error == ERROR_BROKEN_PIPE) break;
                        state.ReaderError = true;
                        lock (shared.Sync) if (shared.Violation == null) shared.Violation = state.Name + "_reader_error";
                        break;
                    }
                    if (read == 0) break;
                    int count = checked((int)read);
                    int retained;
                    lock (shared.Sync)
                    {
                        long streamBefore = state.Seen;
                        long aggregateBefore = shared.TotalSeen;
                        state.Seen = SaturatingAdd(state.Seen, count);
                        shared.TotalSeen = SaturatingAdd(shared.TotalSeen, count);
                        shared.LastActivityTimestamp = Stopwatch.GetTimestamp();
                        long streamRemaining = Math.Max(0, state.Limit - streamBefore);
                        long aggregateRemaining = Math.Max(0, profile.AggregateBytes - aggregateBefore);
                        retained = (int)Math.Min(count, Math.Min(streamRemaining, aggregateRemaining));
                        if (state.Seen > state.Limit && shared.Violation == null)
                            shared.Violation = state.Name + "_overflow";
                        else if (shared.TotalSeen > profile.AggregateBytes && shared.Violation == null)
                            shared.Violation = "aggregate_overflow";
                    }
                    state.Retain(buffer, retained);
                }
            }
            catch
            {
                state.ReaderError = true;
                lock (shared.Sync) if (shared.Violation == null) shared.Violation = state.Name + "_reader_error";
            }
            finally
            {
                state.Completed = true;
            }
        }

        private static bool JoinReader(StreamState state, int timeout, ResourceLedger ledger, ref int cleanupErrors)
        {
            if (state == null) return true;
            bool joined = false;
            try { joined = state.Thread != null && state.Thread.Join(timeout); }
            catch { cleanupErrors++; }
            if (joined && state.Completed)
            {
                try { ledger.Prove(state.ReaderObligation, "joined"); }
                catch { cleanupErrors++; ledger.Fail(state.ReaderObligation); }
            }
            else
            {
                cleanupErrors++;
                ledger.Fail(state.ReaderObligation);
            }
            return joined && state.Completed;
        }

        private static void TerminateOwnedTree(IntPtr job, RunnerResult result)
        {
            if (job == IntPtr.Zero || result.CleanupInvocations != 0) return;
            result.CleanupInvocations++;
            try
            {
                if (!TerminateJobObject(job, 0xE002U)) result.SecondaryCleanupErrors++;
            }
            catch { result.SecondaryCleanupErrors++; }
        }

        private static void TerminateOwnedProcess(IntPtr process, RunnerResult result)
        {
            if (process == IntPtr.Zero || result.CleanupInvocations != 0) return;
            result.CleanupInvocations++;
            try
            {
                uint exitCode;
                if (!GetExitCodeProcess(process, out exitCode) ||
                    (exitCode == STILL_ACTIVE && !TerminateProcess(process, 0xE001U)))
                    result.SecondaryCleanupErrors++;
            }
            catch { result.SecondaryCleanupErrors++; }
        }

        private static bool WaitJobEmpty(IntPtr job, int timeout)
        {
            if (job == IntPtr.Zero) return true;
            Stopwatch timer = Stopwatch.StartNew();
            do
            {
                try { if (ActiveProcesses(job) == 0) return true; }
                catch { return false; }
                Thread.Sleep(10);
            } while (timer.ElapsedMilliseconds < timeout);
            return SafeJobEmpty(job);
        }

        private static bool SafeJobEmpty(IntPtr job)
        {
            try { return ActiveProcesses(job) == 0; }
            catch { return false; }
        }

        private static uint ActiveProcesses(IntPtr job)
        {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ref accounting,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero))
                throw Win32("job_accounting_failed");
            return accounting.ActiveProcesses;
        }

        private static void CloseTracked(ref IntPtr handle, Obligation obligation, ResourceLedger ledger, ref int cleanupErrors)
        {
            if (obligation == null) return;
            if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE)
            {
                if (obligation.State == "reserved") ledger.Prove(obligation, "no-resource");
                return;
            }
            IntPtr value = handle;
            handle = IntPtr.Zero;
            try
            {
                if (CloseHandle(value)) ledger.Prove(obligation, "closed");
                else { cleanupErrors++; ledger.Fail(obligation); }
            }
            catch { cleanupErrors++; ledger.Fail(obligation); }
        }

        private static long CreationFileTime(IntPtr process)
        {
            FILETIME creation, exit, kernel, user;
            if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) throw Win32("process_identity_failed");
            return ((long)creation.dwHighDateTime << 32) | creation.dwLowDateTime;
        }

        private static long ElapsedSince(long timestamp)
        {
            long delta = Stopwatch.GetTimestamp() - timestamp;
            return (long)(delta * 1000.0 / Stopwatch.Frequency);
        }

        private static long SaturatingAdd(long left, long right)
        {
            if (right > 0 && left > Int64.MaxValue - right) return Int64.MaxValue;
            return left + right;
        }

        private static string BuildCommandLine(string executable, string[] arguments)
        {
            StringBuilder b = new StringBuilder();
            b.Append(QuoteArgument(executable));
            foreach (string argument in arguments) b.Append(' ').Append(QuoteArgument(argument));
            return b.ToString();
        }

        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '\"' }) < 0) return value;
            StringBuilder b = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '\"')
                {
                    b.Append('\\', slashes * 2 + 1).Append('\"');
                    slashes = 0;
                    continue;
                }
                if (slashes > 0) { b.Append('\\', slashes); slashes = 0; }
                b.Append(c);
            }
            if (slashes > 0) b.Append('\\', slashes * 2);
            return b.Append('\"').ToString();
        }

        private static IntPtr BuildEnvironment(string operationId, string workingDirectory, ResourceLedger ledger)
        {
            SortedDictionary<string, string> values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            {
                string key = Convert.ToString(entry.Key);
                string value = Convert.ToString(entry.Value);
                if (!String.IsNullOrEmpty(key) && key.IndexOf('=') < 0 && key.IndexOf('\0') < 0 && value.IndexOf('\0') < 0)
                    values[key] = value;
            }
            values["SHUHAI_BOUND_SESSION"] = "1";
            values["SHUHAI_SESSION_TOKEN"] = SessionToken(ledger);
            values["SHUHAI_SESSION_ROOT"] = operationId;
            values["SHUHAI_REPO_ROOT"] = Path.GetFullPath(workingDirectory).TrimEnd(Path.DirectorySeparatorChar);
            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> item in values)
                block.Append(item.Key).Append('=').Append(item.Value).Append('\0');
            block.Append('\0');
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        private static string SessionToken(ResourceLedger ledger)
        {
            Obligation randomObligation = ledger.Reserve("session-random-generator");
            byte[] bytes = new byte[32];
            RandomNumberGenerator random = null;
            try
            {
                random = RandomNumberGenerator.Create();
                ledger.Bind(randomObligation);
                random.GetBytes(bytes);
                random.Dispose();
                ledger.Prove(randomObligation, "disposed");
            }
            catch
            {
                if (random == null) ledger.Prove(randomObligation, "no-resource");
                else
                {
                    try { random.Dispose(); ledger.Prove(randomObligation, "disposed-after-failure"); }
                    catch { ledger.Fail(randomObligation); }
                }
                throw;
            }
            StringBuilder b = new StringBuilder(64);
            foreach (byte value in bytes) b.Append(value.ToString("x2"));
            return b.ToString();
        }

        private static string EmptyDigest()
        {
            return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        }

        private static ReceiptReservation ReserveReceipt(RunnerRequest request)
        {
            ReceiptReservation reservation = new ReceiptReservation
            {
                PendingPath = request.ReceiptPath + ".pending",
            };
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(request.ReceiptPath));
                reservation.ReceiptMutex = new Mutex(false, ReceiptMutexName);
                bool owned;
                try { owned = reservation.ReceiptMutex.WaitOne(2000, false); }
                catch (AbandonedMutexException) { owned = true; }
                if (!owned) throw new IOException("receipt_mutex_busy");
                reservation.MutexOwned = true;
                reservation.PendingStream = new FileStream(
                    reservation.PendingPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None);
                reservation.PendingOwned = true;
                return reservation;
            }
            catch
            {
                CleanupUncommittedReceipt(reservation);
                throw;
            }
        }

        private static void PublishReceipt(
            RunnerRequest request,
            RunnerResult result,
            ReceiptReservation reservation)
        {
            if (!reservation.PendingOwned || reservation.PendingStream == null)
                throw new InvalidOperationException("receipt_reservation_missing");
            byte[] bytes = new UTF8Encoding(false).GetBytes(result.ToJson() + "\n");
            if (bytes.Length > request.ReceiptMaxBytes) throw new IOException("receipt_limit_exceeded");
            reservation.PendingStream.Write(bytes, 0, bytes.Length);
            reservation.PendingStream.Flush(true);
            reservation.PendingStream.Dispose();
            reservation.PendingStream = null;
            if (File.Exists(request.ReceiptPath))
                File.Replace(reservation.PendingPath, request.ReceiptPath, null, true);
            else
                File.Move(reservation.PendingPath, request.ReceiptPath);
            reservation.PendingOwned = false;
            reservation.Committed = true;
        }

        private static void CleanupUncommittedReceipt(ReceiptReservation reservation)
        {
            if (reservation == null) return;
            try
            {
                if (reservation.PendingStream != null) reservation.PendingStream.Dispose();
            }
            catch { }
            reservation.PendingStream = null;
            if (reservation.PendingOwned)
            {
                try
                {
                    if (File.Exists(reservation.PendingPath))
                    {
                        File.Delete(reservation.PendingPath);
                        reservation.PendingOwned = false;
                    }
                }
                catch { }
            }
            try { if (reservation.MutexOwned) reservation.ReceiptMutex.ReleaseMutex(); }
            catch { }
            reservation.MutexOwned = false;
            try { if (reservation.ReceiptMutex != null) reservation.ReceiptMutex.Dispose(); }
            catch { }
            reservation.ReceiptMutex = null;
        }

        private static void ReleaseCommittedReceipt(ReceiptReservation reservation)
        {
            if (reservation == null) return;
            try { if (reservation.MutexOwned) reservation.ReceiptMutex.ReleaseMutex(); }
            catch { }
            reservation.MutexOwned = false;
            try { if (reservation.ReceiptMutex != null) reservation.ReceiptMutex.Dispose(); }
            catch { }
            reservation.ReceiptMutex = null;
        }

        private static Exception Win32(string label)
        {
            return new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), label);
        }
    }
}
