package io.foldr.ngtesthost;

import java.io.*;
import java.util.Arrays;

/**
 * Read all data from stdin and output it unchanged.
 *
 * Options:
 *   --bytes-per-second <value>
 *       Throttle throughput to (approximately this amount
 *
 *   --stderr
 *   	 Write output to stderr instead of stdout.
 */
public class Echo {
	private static final int BUFFER_SIZE = 1024 * 8;

	private String id;
	private long bytesPerSecond;
	private boolean echoToStderr;
	private boolean reportStatus;

	public Echo(String id, long bytesPerSecond, boolean echoToStderr, boolean reportStatus) {
		this.id = id;
		this.bytesPerSecond = bytesPerSecond;
		this.echoToStderr = echoToStderr;
		this.reportStatus = reportStatus;
	}

	public static void main(String[] args) {
		String id = getOptionValue(args, "--id");
		if(id == null)
			id = Echo.class.getCanonicalName();
		long bytesPerSecond = getBytesPerSecond(args);

		boolean echoToStderr = Arrays.asList(args).contains("--stderr");
		boolean reportStatus = Arrays.asList(args).contains("--print-status");

		new Echo(id, bytesPerSecond, echoToStderr, reportStatus).run();
	}

	private class StatusReporter implements Runnable {
		@Override
		public void run() {
			while(true) {
				try { Thread.sleep(1000); }
				catch (InterruptedException e) { return; }

				log("blocked on %s\n", status);
			}
		}
	}

	private enum Status {
		STARTING, READING, WRITING, SLEEPING, FINISHING;
	}

	private Status status;

	private PrintStream getRawOut() {
		return echoToStderr ? System.err : System.out;
	}

	private PrintStream getRawErr() {
		return echoToStderr ? System.out : System.err;
	}

	public void run() {
		status = Status.STARTING;

		Thread reporter = null;

		if(bytesPerSecond != -1) {
			log("Throttling throughput to %d bytes/sec\n", bytesPerSecond);
		}

		try {
			if(reportStatus) {
				reporter = new Thread(new StatusReporter());
				reporter.start();
			}

			InputStream in = new BufferedInputStream(System.in);
			OutputStream out = new BufferedOutputStream(getRawOut());
			byte[] buffer = new byte[BUFFER_SIZE];
			double deferredDelay = 0;

			while(true) {
				status = Status.READING;
				int count = in.read(buffer);
				if(count == -1) {
					status = Status.FINISHING;
					break;
				}
				status = Status.WRITING;
				out.write(buffer, 0, count);

				if(bytesPerSecond != -1) {
					double pause = 1000 / (bytesPerSecond / (double)count);
					if(deferredDelay + pause < 50) {
						deferredDelay += pause;
					}
					else {
						status = Status.SLEEPING;
						try { Thread.sleep((long)(deferredDelay + pause)); }
						catch (InterruptedException e) {
							throw new RuntimeException("interrupted", e);
						}
						deferredDelay = 0;
					}
				}
			}
			// Old versions of the nailgun server failed to send an EXIT chunk
			// if a nail closed System.out, so we just flush it.
			out.flush();
			if(reporter != null) {
				reporter.interrupt();
				reporter.join();
			}
		}
		catch(IOException | InterruptedException e) {
			log("Failed to copy stdin to stdout: %s", e);
			System.exit(1);
		}
		finally {
			if(reporter != null) {
				reporter.interrupt();
			}
		}
	}

	private static long getBytesPerSecond(String[] args) {
		String value = getOptionValue(args, "--bytes-per-second");
		if(value == null)
			return -1;
		try {
			long bps = Long.parseLong(value);
			if(bps < 1) {
				throw new RuntimeException("--bytes-per-second value must be > 0");
			}
			return bps;
		}
		catch (NumberFormatException e) {
			throw new RuntimeException("Invalid --bytes-per-second: " + value);
		}
	}

	private static String getOptionValue(String[] args, String option) {
		for(int i = 0; i < args.length; ++i) {
			if(option.equals(args[i])) {
				if(i + 1 < args.length) {
					return args[i + 1];
				}
				else {
					throw new RuntimeException(option + " must be followed by a value");
				}
			}
		}
		return null;
	}

	private void log(String message, Object...values) {
		getRawErr().print(String.format("[%s]: ", id) + String.format(message, values));
	}
}
