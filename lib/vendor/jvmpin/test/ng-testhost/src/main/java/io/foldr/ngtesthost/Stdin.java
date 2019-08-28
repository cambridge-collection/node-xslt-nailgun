package io.foldr.ngtesthost;

import java.util.Scanner;

public class Stdin {
	public static void main(String[] args) {
		System.out.println("Started Stdin");

		Scanner scanner = new Scanner(System.in);
		String input = "";
		while (!"quit".equalsIgnoreCase(input)) {
			input = scanner.next();
			System.out.println("echo> " + input);
		}
	}
}
