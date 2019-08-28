package io.foldr.ngtesthost;

import java.nio.ByteBuffer;

public class StdoutBinary {
	public static void main(String[] args) {
		int number;
		try {
			number = Integer.parseInt(args[0]);
		} catch (Exception e) {
			number = 1695609641;
		}

        byte[] bytes = ByteBuffer.allocate(4).putInt(number).array();
        System.out.write(bytes, 0, bytes.length);
	}
}
